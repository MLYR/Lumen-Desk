import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { kvSet } from '../src/db.js';
import { parseResume, saveResume, saveSettings } from '../src/resume.js';
import { authed, setup } from './helpers.js';

const j = async (res: Response | Promise<Response>) => (await (await res).json()) as Record<string, any>;

describe('backup: full content export/import', () => {
  it('round-trips posts, taxonomy, bookmarks, profile, résumé and uploads while leaving auth intact', async () => {
    const source = await authed();
    const category = await j(source.send('POST', '/api/private/categories', { name: '测试分类', slug: 'test-cat', description: '分类描述' }));
    await source.send('POST', '/api/private/tags', { name: '空闲标签' });
    await source.create({
      title: '一篇备份文章',
      slug: 'backup-post',
      summary: '摘要',
      tags: ['备份标签', 'Docker'],
      categoryId: category.id,
      publishedAt: '2026-10-30T02:00:00Z',
      markdown: '# 正文\n\n内容',
    });

    const avatarName = '0123456789abcdef.webp';
    const uploadsDir = path.join(source.dataDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, avatarName), Buffer.from('synthetic-avatar'));
    kvSet(source.db, 'profile', JSON.stringify({
      name: '备份测试',
      tagline: '一句话',
      bio: '简介',
      avatar: `/uploads/${avatarName}`,
      facts: [{ label: '职业', value: '程序员' }],
      links: [{ label: '主页', url: 'https://example.com' }],
    }));
    saveResume(source.db, parseResume({ basics: { name: { value: '备份测试', sensitive: true }, title: '工程师' } }, source.clock.t));
    saveSettings(source.db, { revealPublic: true });

    const bm = new FormData();
    bm.append('file', new File([
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n<DT><H3>工作</H3>\n<DL><p><DT><A HREF="https://example.com">Example</A>\n</DL><p>\n</DL><p>',
    ], 'bookmarks.html'));
    expect((await source.upload('/api/private/bookmarks/import', bm)).status).toBe(200);

    const res = await source.req('/api/private/backup/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="lumen-desk-backup-\d{12}\.zip"$/);
    const zip = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      'content.json',
      'manifest.json',
      `uploads/${avatarName}`,
    ]);

    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as Record<string, any>;
    expect(manifest).toMatchObject({
      format: 'lumen-desk-backup',
      version: 1,
      counts: { posts: 1, categories: 6, tags: expect.any(Number), folders: 1, bookmarks: 1, uploads: 1 },
    });
    expect(manifest.note).toContain('恢复码');
    const content = JSON.parse(strFromU8(files['content.json']!)) as Record<string, any>;
    expect(content.posts[0]).toMatchObject({
      slug: 'backup-post',
      category: 'test-cat',
      tags: ['备份标签', 'Docker'],
      status: 'published',
      publishedAt: '2026-10-30T02:00:00.000Z',
    });
    expect(content.bookmarks[0].links[0]).toMatchObject({ title: 'Example', url: 'https://example.com' });
    expect(content.categories.find((c: any) => c.slug === 'test-cat')).toMatchObject({ name: '测试分类', description: '分类描述' });
    expect(content.tags.map((t: any) => t.name)).toContain('空闲标签');
    expect(content.profile.avatar).toBe(`/uploads/${avatarName}`);
    expect(content.resume.settings).toBeUndefined();
    expect(content.resumeSettings).toEqual({ revealPublic: true });
    expect(content).not.toHaveProperty('sessions');
    expect(content).not.toHaveProperty('recoveryCodes');

    const target = await authed();
    await target.create({ title: '会被覆盖', slug: 'old-post' });
    const form = new FormData();
    form.append('file', new File([zip], 'backup.zip'));
    const imported = await target.upload('/api/private/backup/import', form);
    expect(imported.status).toBe(200);
    expect(await j(imported)).toMatchObject({ posts: 1, categories: 6, folders: 1, bookmarks: 1, uploads: 1 });

    const posts = await j(target.req('/api/private/posts'));
    expect(posts.items.map((p: any) => p.slug)).toEqual(['backup-post']);
    const post = await j(target.req(`/api/private/posts/${posts.items[0].id}`));
    expect(post).toMatchObject({ title: '一篇备份文章', publishedAt: '2026-10-30T02:00:00.000Z', category: { slug: 'test-cat', name: '测试分类' } });

    const cats = await j(target.req('/api/private/categories'));
    expect(cats.items.find((c: any) => c.slug === 'test-cat')).toMatchObject({ name: '测试分类', description: '分类描述' });
    const tags = await j(target.req('/api/private/tags'));
    expect(tags.items.map((t: any) => t.name)).toContain('备份标签');
    expect(tags.items.map((t: any) => t.name)).toContain('空闲标签');

    const bookmarks = await j(target.req('/api/private/bookmarks'));
    expect(bookmarks[0]).toMatchObject({ name: '工作', items: [{ title: 'Example', url: 'https://example.com' }] });
    expect(fs.readFileSync(path.join(target.dataDir, 'uploads', avatarName), 'utf8')).toBe('synthetic-avatar');

    expect(await j(target.req('/api/private/profile'))).toMatchObject({ name: '备份测试', avatar: `/uploads/${avatarName}` });
    expect(await j(target.req('/api/private/resume'))).toMatchObject({ basics: { name: { value: '备份测试' } }, settings: { revealPublic: true } });
    expect((await target.req('/api/private/security')).status).toBe(200);
  });

  it('rejects unauthenticated, malformed and wrong-format uploads', async () => {
    const anon = setup();
    expect((await anon.app.request('/api/private/backup/export')).status).toBe(401);

    const { upload } = await authed();
    const bad = new FormData();
    bad.append('file', new File(['not a zip'], 'bad.zip'));
    const r = await upload('/api/private/backup/import', bad);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'invalid_request' });

    const empty = new FormData();
    empty.append('file', new File([], 'empty.zip'));
    expect((await upload('/api/private/backup/import', empty)).status).toBe(400);

    const wrongType = await upload('/api/private/backup/import', new FormData(), { 'content-type': 'application/json' });
    expect(wrongType.status).toBe(415);
  });

  it('does not mutate data when a later validation step fails', async () => {
    const source = await authed();
    const res = await source.req('/api/private/backup/export');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const content = JSON.parse(strFromU8(files['content.json']!)) as Record<string, any>;
    content.posts = [{ ...content.posts[0], slug: 'broken', category: 'missing-category' }];
    const { zipSync, strToU8 } = await import('fflate');
    const zip = zipSync({ ...files, 'content.json': strToU8(JSON.stringify(content)) });

    const target = await authed();
    await target.create({ title: '保留我', slug: 'keep-me' });
    const form = new FormData();
    form.append('file', new File([zip], 'bad-content.zip'));
    const out = await target.upload('/api/private/backup/import', form);
    expect(out.status).toBe(400);
    expect((await j(target.req('/api/private/posts'))).items.map((p: any) => p.slug)).toEqual(['keep-me']);
  });
});
