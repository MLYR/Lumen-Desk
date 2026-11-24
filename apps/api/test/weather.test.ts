import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { formatProvinceCity } from '../src/sources/cn-cities.js';
import {
  classifyIp,
  describeWmo,
  refreshWeather,
  WEATHER_MAX_AGE_MS,
} from '../src/sources/weather.js';
import { authed, ORIGIN, SECRET, sessionCookie, setup, SHELL_FIXTURE } from './helpers.js';

const sampleOpenMeteo = {
  current: {
    temperature_2m: 14.04,
    apparent_temperature: 12.26,
    relative_humidity_2m: 70.4,
    weather_code: 3,
    wind_speed_10m: 8.84,
    is_day: 0,
  },
  daily: {
    time: ['2026-11-23', '2026-11-24', '2026-11-25'],
    weather_code: [51, 0, 95],
    temperature_2m_max: [17.12, 12.54, 11.49],
    temperature_2m_min: [11.01, 4.52, 1.73],
    precipitation_probability_max: [20, 3, null],
  },
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

describe('/api/private/weather & settings', () => {
  it('requires authentication on all weather endpoints', async () => {
    const { app } = setup();
    expect((await app.request('/api/private/weather')).status).toBe(401);
    expect((await app.request('/api/private/weather/settings')).status).toBe(401);
    expect((await app.request('/api/private/weather/search?q=西安')).status).toBe(401);
    expect(
      (
        await app.request('/api/private/weather/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ mode: 'ip' }),
        })
      ).status,
    ).toBe(401);
  });

  it('validates weather coordinates, timezone, IP classification, and province-city formatting', () => {
    expect(() => loadConfig({ WEATHER_LAT: '99' })).toThrow(/WEATHER_LAT/);
    expect(() => loadConfig({ WEATHER_LON: 'not-a-number' })).toThrow(/WEATHER_LON/);
    expect(() => loadConfig({ WEATHER_TIMEZONE: 'Asia/Shanghai;rm' })).toThrow(/WEATHER_TIMEZONE/);
    const cfg = loadConfig({ WEATHER_CITY: '西安', WEATHER_LAT: '34.26', WEATHER_LON: '108.94' });
    expect(cfg.weatherCity).toBe('西安');
    expect(cfg.weatherLat).toBe(34.26);
    expect(cfg.weatherLon).toBe(108.94);

    expect(classifyIp('127.0.0.1')).toEqual({ kind: 'private' });
    expect(classifyIp('::ffff:172.18.0.1')).toEqual({ kind: 'private' });
    expect(classifyIp('198.18.0.2')).toEqual({ kind: 'private' });
    expect(classifyIp('::ffff:223.5.5.5')).toEqual({ kind: 'ipv4', ip: '223.5.5.5' });
    expect(classifyIp('2001:4860:4860::8888')).toEqual({ kind: 'ipv6', ip: '2001:4860:4860::8888' });

    expect(formatProvinceCity('上海市', '上海')).toBe('上海市');
    expect(formatProvinceCity('上海市', '上海市')).toBe('上海市');
    expect(formatProvinceCity('上海市', '浦东新区')).toBe('上海市 浦东新区');
    expect(formatProvinceCity('陕西省', '西安市')).toBe('陕西省 西安市');
    expect(formatProvinceCity('吉林省', '吉林市')).toBe('吉林省 吉林市');
  });

  it('maps Open-Meteo data, checks location match, keeps cache on error, and expires stale entries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, clock, config, req } = await authed();
    const now = () => clock.t;
    const loc = { province: '上海市', city: config.weatherCity, lat: config.weatherLat, lon: config.weatherLon, timezone: config.weatherTimezone };

    // Empty before fetch when weatherFetch is not wired in bare setup()
    const initRes = await req('/api/private/weather');
    expect(initRes.status).toBe(200);
    expect(initRes.headers.get('cache-control')).toBe('no-store');
    expect(await initRes.json()).toEqual({
      mode: 'ip',
      province: '上海市',
      city: '上海',
      latitude: 31.23,
      longitude: 121.47,
      timezone: 'Asia/Shanghai',
      current: null,
      forecast: [],
      updatedAt: null,
      source: { name: 'Open-Meteo', url: 'https://open-meteo.com' },
    });

    // Fetch Open-Meteo
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(json(sampleOpenMeteo));
    expect(await refreshWeather(db, loc, { siteUrl: config.siteUrl, fetchFn, now })).toBe('updated');
    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('api.open-meteo.com/v1/forecast');
    expect(String(url)).toContain('latitude=31.23');
    expect(String(url)).toContain('longitude=121.47');

    const body = await (await req('/api/private/weather')).json();
    expect(body.province).toBe('上海市');
    expect(body.city).toBe('上海');
    expect(body.current).toEqual({
      temperature: 14,
      apparentTemperature: 12.3,
      humidity: 70,
      windSpeed: 8.8,
      weatherCode: 3,
      condition: '阴',
      icon: 'cloudy',
      isDay: false,
    });
    expect(body.forecast).toEqual([
      { date: '2026-11-23', weatherCode: 51, condition: '毛毛雨', icon: 'rain', tempMin: 11, tempMax: 17.1, precipProb: 20 },
      { date: '2026-11-24', weatherCode: 0, condition: '晴', icon: 'clear-day', tempMin: 4.5, tempMax: 12.5, precipProb: 3 },
      { date: '2026-11-25', weatherCode: 95, condition: '雷阵雨', icon: 'thunder', tempMin: 1.7, tempMax: 11.5, precipProb: null },
    ]);
    expect(body.updatedAt).toBe(new Date(clock.t).toISOString());

    // Error keeps fresh cache
    clock.t += 1800_000;
    fetchFn.mockResolvedValueOnce(new Response('bad', { status: 502 }));
    expect(await refreshWeather(db, loc, { siteUrl: config.siteUrl, fetchFn, now })).toBe('error');
    expect((await (await req('/api/private/weather')).json()).current.temperature).toBe(14);

    // Location mismatch returns empty until refreshed
    const other = setup(clock.t, { WEATHER_CITY: '北京', WEATHER_LAT: '39.9', WEATHER_LON: '116.4' });
    const otherCookie = sessionCookie(await other.login(other.codeAt()));
    const cached = db.prepare('SELECT location, payload, fetched_at FROM weather_cache WHERE id = 1').get() as {
      location: string;
      payload: string;
      fetched_at: number;
    };
    other.db
      .prepare('INSERT INTO weather_cache (id, location, payload, fetched_at) VALUES (1, ?, ?, ?)')
      .run(cached.location, cached.payload, cached.fetched_at);
    const mismatch = await (await other.app.request('/api/private/weather', { headers: { cookie: otherCookie } })).json();
    expect(mismatch.province).toBe('北京市');
    expect(mismatch.city).toBe('北京');
    expect(mismatch.current).toBeNull();

    // Expired (>12h) returns empty
    clock.t += WEATHER_MAX_AGE_MS + 1;
    const expired = await (await req('/api/private/weather')).json();
    expect(expired.current).toBeNull();
    expect(expired.forecast).toEqual([]);

    expect(describeWmo(0, false)).toEqual({ condition: '晴', icon: 'clear-night' });
    expect(describeWmo(73, true)).toEqual({ condition: '中雪', icon: 'snow' });

    warn.mockRestore();
  });

  it('auto-detects province and city from client IP, supports manual override in settings, and searches cities', async () => {
    const config = loadConfig({
      DATA_DIR: ':memory:',
      TOTP_SECRET: SECRET,
      COOKIE_SECURE: 'true',
      TRUST_PROXY: 'true',
      SHELL_DIR: SHELL_FIXTURE,
      SITE_URL: ORIGIN,
    });
    const db = openDb(':memory:');
    const clock = { t: Date.UTC(2026, 10, 24, 2, 0, 0) };

    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('whois.pconline.com.cn')) {
        if (url.includes('ip=223.5.5.5')) {
          return json({ pro: '浙江省', proCode: '330000', city: '杭州市', cityCode: '330100', region: '', regionCode: '0' });
        }
        // Private/local IP queries without ip=
        return json({ pro: '四川省', proCode: '510000', city: '成都市', cityCode: '510100', region: '', regionCode: '0' });
      }
      if (url.includes('ipwho.is/2001%3A4860%3A4860%3A%3A8888')) {
        return json({
          success: true,
          country: '日本',
          country_code: 'JP',
          region: '東京都',
          city: '东京',
          latitude: 35.69,
          longitude: 139.69,
          timezone: { id: 'Asia/Tokyo' },
        });
      }
      if (url.includes('geocoding-api.open-meteo.com')) {
        return json({
          results: [
            { name: '东京', country: '日本', country_code: 'JP', admin1: '東京都', latitude: 35.6895, longitude: 139.6917, timezone: 'Asia/Tokyo' },
          ],
        });
      }
      if (url.includes('api.open-meteo.com/v1/forecast')) {
        return json(sampleOpenMeteo);
      }
      return new Response('not mocked', { status: 500 });
    });

    const app = createApp({ config, db, now: () => clock.t, weatherFetch: fetchFn });
    const base = setup(clock.t);
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '223.5.5.5' },
      body: JSON.stringify({ code: base.codeAt() }),
    });
    const cookie = sessionCookie(loginRes);

    // 1. Default IP mode resolves 223.5.5.5 -> 浙江省 杭州市 and fetches Open-Meteo on demand
    const wxIp = await (
      await app.request('/api/private/weather', {
        headers: { cookie, 'x-forwarded-for': '223.5.5.5' },
      })
    ).json();
    expect(wxIp.mode).toBe('ip');
    expect(wxIp.province).toBe('浙江省');
    expect(wxIp.city).toBe('杭州市');
    expect(wxIp.current.temperature).toBe(14);

    // 2. Private IP (172.18.0.1) queries outbound IP without passing private IP parameter
    const wxLan = await (
      await app.request('/api/private/weather', {
        headers: { cookie, 'x-forwarded-for': '172.18.0.1' },
      })
    ).json();
    expect(wxLan.province).toBe('四川省');
    expect(wxLan.city).toBe('成都市');

    // 3. IPv6 falls back to ipwho.is
    const wxV6 = await (
      await app.request('/api/private/weather', {
        headers: { cookie, 'x-forwarded-for': '2001:4860:4860::8888' },
      })
    ).json();
    expect(wxV6.province).toBe('日本 東京都');
    expect(wxV6.city).toBe('东京');
    expect(wxV6.timezone).toBe('Asia/Tokyo');

    // 4. Settings GET returns current settings, detected IP location, and China province options
    const stRes = await app.request('/api/private/weather/settings', {
      headers: { cookie, 'x-forwarded-for': '223.5.5.5' },
    });
    expect(stRes.status).toBe(200);
    const stBody = await stRes.json();
    expect(stBody.settings.mode).toBe('ip');
    expect(stBody.detected.province).toBe('浙江省');
    expect(stBody.detected.city).toBe('杭州市');
    expect(stBody.provinces.length).toBeGreaterThanOrEqual(34);

    // 5. Validation rejects out-of-range coordinates or bad origin
    const badOrigin = await app.request('/api/private/weather/settings', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ mode: 'ip' }),
    });
    expect(badOrigin.status).toBe(403);

    const badCoord = await app.request('/api/private/weather/settings', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ mode: 'manual', province: '陕西省', city: '西安市', lat: 120, lon: 108.95 }),
    });
    expect(badCoord.status).toBe(400);

    // 6. Save manual location -> overrides IP location immediately
    const putManual = await app.request('/api/private/weather/settings', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '223.5.5.5' },
      body: JSON.stringify({ mode: 'manual', province: '陕西省', city: '西安市', lat: 34.26, lon: 108.95, timezone: 'Asia/Shanghai' }),
    });
    expect(putManual.status).toBe(200);

    const wxManual = await (
      await app.request('/api/private/weather', {
        headers: { cookie, 'x-forwarded-for': '223.5.5.5' },
      })
    ).json();
    expect(wxManual.mode).toBe('manual');
    expect(wxManual.province).toBe('陕西省');
    expect(wxManual.city).toBe('西安市');
    expect(wxManual.latitude).toBe(34.26);
    expect(wxManual.longitude).toBe(108.95);
    expect(wxManual.current.temperature).toBe(14);

    // 7. Switch back to IP mode -> resumes IP location while retaining saved manual city
    const putIp = await app.request('/api/private/weather/settings', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '223.5.5.5' },
      body: JSON.stringify({ mode: 'ip' }),
    });
    expect(putIp.status).toBe(200);
    expect((await putIp.json()).settings.city).toBe('西安市');

    const wxBackToIp = await (
      await app.request('/api/private/weather', {
        headers: { cookie, 'x-forwarded-for': '223.5.5.5' },
      })
    ).json();
    expect(wxBackToIp.mode).toBe('ip');
    expect(wxBackToIp.province).toBe('浙江省');
    expect(wxBackToIp.city).toBe('杭州市');

    // 8. Search local CN city and overseas city
    const cnSearch = await (
      await app.request('/api/private/weather/search?q=' + encodeURIComponent('西安'), { headers: { cookie } })
    ).json();
    expect(cnSearch.results[0]).toMatchObject({ province: '陕西省', city: '西安市' });

    const intlSearch = await (
      await app.request('/api/private/weather/search?q=Tokyo', { headers: { cookie } })
    ).json();
    expect(intlSearch.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ province: '日本 東京都', city: '东京', timezone: 'Asia/Tokyo' })]),
    );
  });
});
