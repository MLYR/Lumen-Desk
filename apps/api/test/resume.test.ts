import { describe, expect, it } from 'vitest';
import { getSettings, makeScrubber, mask, normForm, parseResume, publicView, sensitiveValues, type Resume } from '../src/resume.js';
import { authed, ORIGIN, setup } from './helpers.js';

type Json = Record<string, any>;
const j = async (res: Response | Promise<Response>) => (await (await res).json()) as Json;
const F = (value: string, sensitive = true) => ({ value, sensitive });

/**
 * Synthetic résumé only. Deliberately adversarial:
 * - location「杭州」is part of hometown「浙江杭州」and of the company name (longest-first matters);
 * - client「某公司」equals its own mask, and project「有限公司」is part of another mask
 *   (a replacement that contains a sensitive value);
 * - sensitive words appear in bullets, desc, summary, skills.text, title, stack and a non-sensitive field.
 */
const SAMPLE = {
  basics: {
    name: F('张小三'),
    title: 'Java 开发工程师（张小三）',
    phone: F('13800000000'),
    email: F('zhangsan@example.com'),
    birth: F('2000.01'),
    hometown: F('浙江杭州'),
    location: F('杭州'),
    school: F('杭州示例大学', false),
    degree: F('本科', false),
    gender: F('男', false),
    years: F('5 年', false),
    summary: '我是张小三，电话 13800000000，现居杭州。',
  },
  work: [
    {
      id: 'w-a',
      start: '2022.05',
      end: '至今',
      company: F('杭州示例信息科技有限公司'),
      role: '后端开发',
      bullets: ['在杭州示例信息科技有限公司负责订单系统', '对接客户示例银行的接口', '邮件 zhangsan@example.com 值班'],
    },
    { id: 'w-b', start: '2020.07', end: '2022.04', company: F('示例集团'), role: 'Java 开发', bullets: ['示例集团内部平台维护'] },
  ],
  skills: [
    { id: 's-a', label: '后端框架', text: 'Spring、SpringBoot、MyBatis' },
    { id: 's-b', label: '其他', text: '曾为示例银行做过性能优化' },
  ],
  projects: [
    {
      id: 'p-a',
      name: F('示例订单管理系统'),
      client: F('示例银行'),
      desc: '为示例银行开发的示例订单管理系统，部署在杭州机房。',
      stack: ['Java', 'Spring', '示例银行内部框架'],
      bullets: ['张小三主导设计', '示例订单管理系统 QPS 提升 3 倍'],
    },
    { id: 'p-b', name: F('有限公司'), client: F('某公司'), desc: '某公司和有限公司的合作项目', stack: [], bullets: ['合作方：某公司'] },
    {
      id: 'p-c',
      name: F('对接项目', false),
      client: null,
      desc: '对接示例厂商的示例内部系统，经由示例内部系统网关。',
      stack: ['示例厂商 SDK'],
      bullets: ['和示例厂商联调', '示例内部系统改造'],
    },
  ],
  keywords: ['示例厂商', '示例内部系统', '示例内部系统', '  示例厂商  '],
};

const SECRETS = ['示例厂商', '示例内部系统', '张小三', '13800000000', 'zhangsan@example.com', '2000.01', '浙江杭州', '杭州', '杭州示例信息科技有限公司', '示例集团', '示例订单管理系统', '示例银行', '有限公司', '某公司'];

describe('resume: masks', () => {
  it('follows the contract table', () => {
    expect(mask('name', '张三')).toBe('张*');
    expect(mask('name', '张小三')).toBe('张*三');
    expect(mask('name', '欧阳小明')).toBe('欧*明');
    expect(mask('phone', '13800000000')).toBe('138****0000');
    expect(mask('phone', '138-0000-0000')).toBe('138****0000');
    expect(mask('phone', '+44 20 7946 0000')).toBe('**************00');
    expect(mask('email', 'zhangsan@example.com')).toBe('z***@example.com');
    expect(mask('birth', '2000.1.1')).toBe('2000.**');
    expect(mask('place', '浙江 杭州')).toBe('浙江**');
    expect(mask('place', '浙江杭州')).toBe('浙江**');
    expect(mask('company', '杭州示例信息科技有限公司')).toBe('某信息科技有限公司');
    expect(mask('company', '示例集团')).toBe('某集团');
    expect(mask('project', '示例订单管理系统')).toBe('某管理系统');
    expect(mask('project', '示例平台')).toBe('某平台');
    expect(mask('company', 'Acme')).toBe('某公司');
    expect(mask('project', 'Phoenix')).toBe('某项目');
    expect(mask('other', '本科')).toBe('**');
    // Length of names/companies does not leak.
    expect(mask('company', '甲有限公司')).toBe(mask('company', '甲乙丙丁戊己庚有限公司'));
  });
});

describe('resume: scrubbing never leaks a sensitive value', () => {
  const r = parseResume(SAMPLE, 0);

  it('the public JSON contains none of the sensitive values, anywhere', () => {
    const body = JSON.stringify(publicView(r, { revealPublic: false }));
    for (const v of SECRETS) expect(body, v).not.toContain(v);
    // Every value counted as sensitive is checked, not just the list above.
    for (const { value } of sensitiveValues(r)) expect(body, value).not.toContain(value);
    // ids are user-settable, so they're positional in public.
    expect(body).not.toContain('w-a');
  });

  it('longest first: 浙江杭州 is masked as a whole, not via 杭州', () => {
    const pub = publicView(r, { revealPublic: false });
    expect(pub.basics.hometown).toEqual({ text: '浙江**', masked: true });
    expect(pub.basics.location).toEqual({ text: '**', masked: true });
    // Its mask「某信息科技有限公司」contains the sensitive project name「有限公司」, so a placeholder is used.
    expect(pub.work[0]!.company).toEqual({ text: '（已隐藏）', masked: true });
    expect(pub.work[0]!.bullets[0]).toBe('在（已隐藏）负责订单系统');
    expect(pub.work[1]!.company).toEqual({ text: '某集团', masked: true });
    expect(pub.projects[0]!.stack).toEqual(['Java', 'Spring', '某银行内部框架']);
    expect(pub.basics.title).toBe('Java 开发工程师（张*三）');
    expect(pub.projects[0]!.desc).toBe('为某银行开发的某管理系统，部署在**机房。');
    expect(pub.basics.summary).toBe('我是张*三，电话 138****0000，现居**。');
    // Non-sensitive field containing a sensitive word: scrubbed and marked.
    expect(pub.basics.school).toEqual({ text: '**示例大学', masked: true });
    expect(pub.basics.degree).toEqual({ text: '本科', masked: false });
  });

  it('a value equal to its own mask falls back to a guard instead of leaking', () => {
    const pub = publicView(r, { revealPublic: false });
    expect(pub.projects[1]!.client!.masked).toBe(true);
    expect(pub.projects[1]!.client!.text).toBe('（已隐藏）');
    expect(pub.projects[1]!.desc).toBe('（已隐藏）和（已隐藏）的合作项目');
    expect(pub.projects[1]!.bullets[0]).toBe('合作方：（已隐藏）');
  });

  it.each([
    ['sample', () => r],
    ['keyword-heavy', () => parseResume({ basics: { name: F('{{PERSON_2pj6jsn5}}') }, projects: [{ name: F('示例系统') }], keywords: ['某系统', '示例厂商', '厂商系统', '系统', '某公司'] }, 0)],
  ])('invariant holds on random text built from the secrets and their masks (%s)', (_n, make) => {
    const secrets = sensitiveValues(make());
    expect(secrets.some((x) => x.replacement === '某系统' || x.replacement === '（已隐藏）')).toBe(true);
    const scrub = makeScrubber(secrets);
    // Also when every guard contains a secret (the text is then dropped to '').
    const nasty = makeScrubber([{ value: '已隐藏', replacement: '***' }, { value: '**', replacement: '■■' }, { value: '■■', replacement: 'x' }]);
    for (const s of ['已隐藏 ** ■■', '（已隐藏）', '*■*■']) for (const v of ['已隐藏', '**', '■■']) expect(nasty(s)).not.toContain(v);
    // Variants of each value: spaced/NBSP between characters, separators between digits, full-width, case.
    const fw = (t: string) => [...t].map((ch) => (ch >= '!' && ch <= '~' ? String.fromCharCode(ch.charCodeAt(0) + 0xfee0) : ch)).join('');
    const variants = (v: string) => {
      const c = [...v];
      return [v, c.join(' '), c.join('\u00a0'), c.join('-'), c.join(' · '), fw(v), v.toUpperCase(), v.normalize('NFD'), `+86 ${v}`, c.slice(0, 3).join('') + '-' + c.slice(3, 7).join('') + '-' + c.slice(7).join('')];
    };
    const parts = [
      ...secrets.flatMap((s) => [...variants(s.value), s.replacement, s.value.slice(1), s.value.slice(0, -1)]),
      '某', '*', '公司', '有限', ' ', 'x', '-', '\u00a0', '2024', 'v1.2.3',
    ];
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) % n;
    for (let i = 0; i < 3000; i++) {
      let s = '';
      for (let k = rnd(8) + 1; k > 0; k--) s += parts[rnd(parts.length)];
      const out = scrub(s);
      const n = normForm(out);
      for (const { value } of secrets) {
        expect(out.includes(value), `${s} → ${out}`).toBe(false);
        // Phones are checked by their digits, the rest by their normalised form.
        const forms = /\d{7}/.test(value.replace(/\D/g, '')) ? [value.replace(/\D/g, ''), value.replace(/\D/g, '').replace(/^86(?=\d{11}$)/, '')] : [normForm(value)];
        for (const f of forms) if (f.length >= 2) expect(n.includes(f), `${s} → ${out} (${f})`).toBe(false);
      }
    }
  });

  it('keywords: replaced with「某系统」in desc, bullets and stack; deduped; never returned publicly', () => {
    expect(r.keywords).toEqual(['示例厂商', '示例内部系统']);
    const pub = publicView(r, { revealPublic: false });
    expect(pub.projects[2]!.desc).toBe('对接某系统的某系统，经由某系统网关。');
    expect(pub.projects[2]!.bullets).toEqual(['和某系统联调', '某系统改造']);
    expect(pub.projects[2]!.stack).toEqual(['某系统 SDK']);
    expect(pub).not.toHaveProperty('keywords');
    expect(JSON.stringify(publicView(r, { revealPublic: true }))).not.toContain('"keywords"');
  });

  it('keywords and field values that are substrings of each other', () => {
    const rr = parseResume(
      {
        basics: { name: F('{{PERSON_2pj6jsn5}}'), location: F('北京') },
        work: [{ company: F('北京示例系统有限公司'), bullets: ['北京示例系统有限公司的示例系统和某系统'] }],
        projects: [{ name: F('示例系统'), desc: '示例系统接入北京示例和系统' }],
        // 「某系统」(the keyword mask) is itself a keyword; 「北京示例」is inside a field value;
        // 「示例系统」equals a field value (keeps the field's own mask); 「系统」is inside the mask.
        keywords: ['某系统', '北京示例', '示例系统', '系统'],
      },
      0,
    );
    const secrets = sensitiveValues(rr);
    expect(secrets.find((x) => x.value === '示例系统')).toBeDefined();
    const body = JSON.stringify(publicView(rr, { revealPublic: false }));
    for (const v of ['{{PERSON_2pj6jsn5}}', '北京', '北京示例系统有限公司', '示例系统', '某系统', '北京示例', '系统']) expect(body, v).not.toContain(v);
    // With 「系统」sensitive, the keyword mask「某系统」would leak it: the safe placeholder is used.
    expect(secrets.find((x) => x.value === '北京示例')!.replacement).toBe('（已隐藏）');
  });

  it('variants: phone with spaces, dashes, full-width digits, +86; e-mail case; spaced names; NFC/NFD keywords', () => {
    // Synthetic values built in code so every variant's exact shape is visible here.
    const d = ['1', '3', '8', '0', '0', '1', '2', '0', '0', '0', '0'].join('');
    const mail = ['zhangsan', 'example.com'].join('@');
    const name = ['张', '小', '三'].join('');
    const rr = parseResume(
      {
        basics: { name: F(name), phone: F(d), email: F(mail) },
        // NFD input is stored as NFC.
        keywords: ['Caf\u0065\u0301 系统'],
      },
      0,
    );
    expect(rr.keywords).toEqual(['Café 系统']);
    const scrub = makeScrubber(sensitiveValues(rr));
    const m = mask('phone', d);
    expect(m).toBe(`${d.slice(0, 3)}****${d.slice(7)}`);
    const fw = (t: string) => [...t].map((ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).join('');
    const g = (sep: string) => `${d.slice(0, 3)}${sep}${d.slice(3, 7)}${sep}${d.slice(7)}`;
    const cases: Array<[string, string]> = [
      [`电话 ${g(' ')}`, `电话 ${m}`],
      [`电话 ${g('-')}`, `电话 ${m}`],
      [`电话 ${g('\u00a0')}`, `电话 ${m}`],
      [`电话 ${[...d].join(' ')}`, `电话 ${m}`],
      [`电话 ${g('.')} / ${g('·')}`, `电话 ${m} / ${m}`],
      [`电话 ${fw(d)}`, `电话 ${m}`],
      [`电话 ${fw(g('-'))}`, `电话 ${m}`],
      [`电话 +86 ${d}`, `电话 +86 ${m}`],
      [`电话 +86-${g('-')}`, `电话 +86-${m}`],
      [`电话 +86${d}`, `电话 +86${m}`],
      [`邮箱 ${mail.toUpperCase()}`, '邮箱 z***@example.com'],
      [`邮箱 ${mail.toLowerCase()}`, '邮箱 z***@example.com'],
      ['邮箱 ZhangSan@Example.Com', '邮箱 z***@example.com'],
      ['我是张 小 三', '我是张*三'],
      ['我是张\u00a0小\u00a0三', '我是张*三'],
      ['我是张  小三', '我是张*三'],
      ['用 Caf\u0065\u0301 系统', '用 某系统'],
      ['用 Café 系统', '用 某系统'],
      ['用 Café系统', '用 某系统'],
    ];
    for (const [input, want] of cases) {
      const out = scrub(input);
      expect(out, input).toBe(want);
      expect(normForm(out), input).not.toContain(d.slice(3, 7));
    }
    // More than 2 separators between digits isn't matched; the final check catches it and hides the whole text.
    expect(scrub(`电话 ${g(' - ')}`)).toBe('（已隐藏）');
    // Full-width text around the number is kept; only the number becomes the mask.
    expect(scrub(`Ｔｅｌ：${fw(d)}`)).toBe(`Ｔｅｌ：${m}`);
  });

  it('ordinary numbers are left alone', () => {
    const d = ['1', '3', '8', '0', '0', '1', '2', '0', '0', '0', '0'].join('');
    const rr = parseResume({ basics: { phone: F(d), birth: F('2000.01') } }, 0);
    const scrub = makeScrubber(sensitiveValues(rr));
    for (const t of [
      '2019 年到 2024 年',
      'Spring Boot 3.2.1，JDK 17',
      'QPS 从 1380 提升到 12000',
      `订单号 ${d.slice(0, 10)}9 的格式`,
      `版本 v${d.slice(0, 3)}.${d.slice(3, 7)}`,
      '电话区号 0138',
      '2000 年',
      '2000.02 入学',
      '日活 2,000,010',
    ]) {
      expect(scrub(t), t).toBe(t);
    }
    // The birth month itself is hidden, also with other separators.
    expect(scrub('生于 2000.01')).toBe('生于 2000.**');
    expect(scrub('生于 2000-01')).toBe('生于 2000.**');
  });

  it('reveal shows originals, masked false', () => {
    const pub = publicView(r, { revealPublic: true });
    expect(pub.reveal).toBe(true);
    expect(pub.basics.name).toEqual({ text: '张小三', masked: false });
    expect(pub.work[0]!.bullets[0]).toBe('在杭州示例信息科技有限公司负责订单系统');
  });
});

describe('resume: API', () => {
  it('404 before import; PUT, GET private, public masked by default, settings, preview, export', async () => {
    const { app, req, send } = await authed();
    expect((await app.request('/api/resume')).status).toBe(404);
    expect(await j(app.request('/api/resume'))).toEqual({ error: 'no_resume' });

    const put = await send('PUT', '/api/private/resume', SAMPLE);
    expect(put.status).toBe(200);
    const saved = await j(put);
    expect(saved.basics.name).toEqual({ value: '张小三', sensitive: true });
    expect(saved.basics.school.sensitive).toBe(false);

    const priv = await j(req('/api/private/resume'));
    expect(priv.settings).toEqual({ revealPublic: false });
    expect(priv.keywords).toEqual(['示例厂商', '示例内部系统']);
    expect(priv.work[0].company.value).toBe('杭州示例信息科技有限公司');

    const pubRes = await app.request('/api/resume');
    expect(pubRes.headers.get('cache-control')).toBe('no-store');
    expect(pubRes.headers.get('x-robots-tag')).toBeNull();
    const pubText = await pubRes.text();
    for (const v of SECRETS) expect(pubText, v).not.toContain(v);
    const pub = JSON.parse(pubText) as Json;
    expect(pub.reveal).toBe(false);
    expect(pub.basics.name).toEqual({ text: '张*三', masked: true });
    expect(pub.basics.school).toEqual({ text: '**示例大学', masked: true });
    expect(pub.basics.phone).toEqual({ text: '138****0000', masked: true });
    expect(pub.basics.email).toEqual({ text: 'z***@example.com', masked: true });
    expect(pub.basics.birth).toEqual({ text: '2000.**', masked: true });

    expect(pub).not.toHaveProperty('keywords');
    // Preview = what visitors see.
    const preview = await req('/api/private/resume/preview');
    const previewText = await preview.text();
    expect(JSON.parse(previewText)).toEqual(pub);
    for (const v of SECRETS) expect(previewText, v).not.toContain(v);

    // Reveal on: originals, noindex, gone from the sitemap.
    expect(await j(send('PUT', '/api/private/resume/settings', { revealPublic: true }))).toEqual({ revealPublic: true });
    const rev = await app.request('/api/resume');
    expect(rev.headers.get('x-robots-tag')).toBe('noindex');
    const revJson = await j(rev);
    expect(revJson.reveal).toBe(true);
    expect(revJson.basics.phone).toEqual({ text: '13800000000', masked: false });
    expect(await (await app.request('/sitemap.xml')).text()).not.toContain('/resume/');
    await send('PUT', '/api/private/resume/settings', { revealPublic: false });
    expect(await (await app.request('/sitemap.xml')).text()).toContain('<loc>https://blog.test/resume/</loc>');

    const exp = await req('/api/private/resume/export');
    expect(exp.headers.get('content-disposition')).toMatch(/^attachment; filename="resume-\d{8}\.json"$/);
    expect(exp.headers.get('cache-control')).toBe('no-store');
    const exported = await j(exp);
    expect(exported.basics.name.value).toBe('张小三');
    expect(exported.keywords).toEqual(['示例厂商', '示例内部系统']);
    // Round trip: the export can be PUT back as is.
    expect((await j(send('PUT', '/api/private/resume', exported))).keywords).toEqual(['示例厂商', '示例内部系统']);
  });

  it('validates input and write checks', async () => {
    const { send } = await authed();
    const long = 'x'.repeat(201);
    const bad: Json[] = [
      { basics: { name: F(long) } },
      { basics: { title: long } },
      { basics: { name: F('a\u0007b') } },
      { basics: { name: F('a\u200bb') } },
      { basics: { name: F('a\u202eb') } },
      { basics: { name: { value: 'x', sensitive: 'yes' } } },
      { work: Array.from({ length: 21 }, () => ({})) },
      { work: [{ bullets: Array.from({ length: 21 }, () => 'b') }] },
      { work: [{ bullets: ['b'.repeat(501)] }] },
      { projects: [{ desc: 'd'.repeat(501) }] },
      { projects: Array.from({ length: 21 }, () => ({})) },
      { skills: Array.from({ length: 31 }, () => ({})) },
      { work: [{ id: 'same' }, { id: 'same' }] },
      { work: [{ id: 'bad id!' }] },
      { keywords: ['x'] },
      { keywords: ['长'.repeat(41)] },
      { keywords: ['a\u200bb'] },
      { keywords: ['a\nb'] },
      { keywords: [12] },
      { keywords: 'a,b' },
      { keywords: Array.from({ length: 51 }, (_, i) => `词${i}`) },
      [],
    ];
    for (const b of bad) expect((await send('PUT', '/api/private/resume', b)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    // 50 distinct keywords (plus duplicates) are fine.
    const fifty = Array.from({ length: 50 }, (_, i) => `词${i}`);
    expect((await j(send('PUT', '/api/private/resume', { keywords: [...fifty, ...fifty.slice(0, 5)] }))).keywords).toHaveLength(50);
    // bullets and desc may contain newlines
    expect((await send('PUT', '/api/private/resume', { work: [{ bullets: ['第一行\n第二行'] }], projects: [{ desc: 'a\nb' }] })).status).toBe(200);
    expect((await send('PUT', '/api/private/resume/settings', { revealPublic: 'true' })).status).toBe(400);
    expect((await send('PUT', '/api/private/resume', SAMPLE, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await send('PUT', '/api/private/resume', 'x', { 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('private routes need a session', async () => {
    const { app } = setup();
    for (const [m, u] of [
      ['GET', '/api/private/resume'],
      ['PUT', '/api/private/resume'],
      ['PUT', '/api/private/resume/settings'],
      ['GET', '/api/private/resume/preview'],
      ['GET', '/api/private/resume/export'],
    ] as const) {
      expect((await app.request(u, { method: m })).status, `${m} ${u}`).toBe(401);
    }
  });

  it('settings default to masked', () => {
    const { db } = setup();
    expect(getSettings(db)).toEqual({ revealPublic: false });
  });
});

export { SAMPLE };
export type { Resume };
