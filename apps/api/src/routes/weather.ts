import type { Context, Hono } from 'hono';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { errorResponse, limit, readJson, requireType, sameOrigin as sameOriginFor } from '../http.js';
import {
  getWeather,
  getWeatherSettings,
  inferProvince,
  IpLocationCache,
  listCnProvinceOptions,
  locationKey,
  needsWeatherRefresh,
  parseWeatherSettings,
  refreshWeather,
  saveWeatherSettings,
  searchWeatherLocations,
  type WeatherLocation,
} from '../sources/weather.js';

export interface WeatherRouteDeps {
  config: Config;
  db: DB;
  now: () => number;
  clientIp: (c: Context) => string;
  fetchFn?: typeof fetch;
}

/** Private weather widget + location settings routes. Register after /api/private/* session middleware. */
export function registerWeather(app: Hono, { config, db, now, clientIp, fetchFn }: WeatherRouteDeps): void {
  const sameOrigin = sameOriginFor(config.siteUrl);
  const ipCache = new IpLocationCache();
  const inflightWeather = new Map<string, Promise<void>>();

  const defaultLoc: WeatherLocation = {
    province: inferProvince(config.weatherCity),
    city: config.weatherCity,
    lat: config.weatherLat,
    lon: config.weatherLon,
    timezone: config.weatherTimezone,
  };

  const ensureWeather = async (loc: WeatherLocation): Promise<void> => {
    if (!fetchFn || !needsWeatherRefresh(db, loc, now())) return;
    const key = locationKey(loc);
    let p = inflightWeather.get(key);
    if (!p) {
      p = refreshWeather(db, loc, { siteUrl: config.siteUrl, fetchFn, now })
        .then(() => {})
        .finally(() => inflightWeather.delete(key));
      inflightWeather.set(key, p);
    }
    await p;
  };

  app.get('/api/private/weather', async (c) => {
    const settings = getWeatherSettings(db, defaultLoc);
    const loc: WeatherLocation =
      settings.mode === 'manual'
        ? {
            province: settings.province,
            city: settings.city,
            lat: settings.lat,
            lon: settings.lon,
            timezone: settings.timezone,
          }
        : await ipCache.resolve(clientIp(c), defaultLoc, { fetchFn, siteUrl: config.siteUrl, now });

    await ensureWeather(loc);
    return c.json(getWeather(db, loc, now(), settings.mode));
  });

  app.get('/api/private/weather/settings', async (c) => {
    const force = c.req.query('refreshIp') === '1';
    const settings = getWeatherSettings(db, defaultLoc);
    const detected = await ipCache.resolve(clientIp(c), defaultLoc, {
      fetchFn,
      siteUrl: config.siteUrl,
      now,
      force,
    });
    return c.json({
      settings,
      detected: {
        province: detected.province ?? '',
        city: detected.city,
        lat: detected.lat,
        lon: detected.lon,
        timezone: detected.timezone,
      },
      provinces: listCnProvinceOptions(),
    });
  });

  app.put(
    '/api/private/weather/settings',
    sameOrigin,
    requireType('application/json'),
    limit(16 * 1024),
    async (c) => {
      try {
        const current = getWeatherSettings(db, defaultLoc);
        const next = saveWeatherSettings(db, parseWeatherSettings(await readJson(c), current));
        const activeLoc: WeatherLocation =
          next.mode === 'manual'
            ? { province: next.province, city: next.city, lat: next.lat, lon: next.lon, timezone: next.timezone }
            : await ipCache.resolve(clientIp(c), defaultLoc, { fetchFn, siteUrl: config.siteUrl, now });
        await ensureWeather(activeLoc);
        return c.json({ settings: next });
      } catch (err) {
        return errorResponse(c, err);
      }
    },
  );

  app.get('/api/private/weather/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const results = await searchWeatherLocations(q, { fetchFn, siteUrl: config.siteUrl });
    return c.json({ results });
  });
}
