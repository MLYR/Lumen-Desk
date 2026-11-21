import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { seedBuiltinLabs } from '../src/lab/seed.js';
import { authed, ORIGIN, setup } from './helpers.js';

const j = async (res: Response | Promise<Response>) => (await (await res).json()) as Record<string, any>;

describe('lab: playground CRUD, zip packaging, file editor, viewer and backup', () => {
  it('enforces auth on write/export endpoints and supports metadata CRUD with visibility rules', async () => {
    const anon = setup();
    expect((await anon.app.request('/api/lab', { method: 'POST' })).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo', { method: 'PATCH' })).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo', { method: 'DELETE' })).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo/export')).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo/upload', { method: 'POST' })).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo/file', { method: 'POST' })).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo/file', { method: 'PUT' })).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo/file', { method: 'DELETE' })).status).toBe(401);
    expect((await anon.app.request('/api/lab/demo/file/rename', { method: 'POST' })).status).toBe(401);

    const s = await authed();

    // Validation & conflict checks
    const badSlug = await s.send('POST', '/api/lab', { slug: 'Bad Slug!', title: 'Test' });
    expect(badSlug.status).toBe(400);

    const createdDraft = await s.send('POST', '/api/lab', {
      slug: 'wave-sim',
      title: '流体波纹',
      intro: 'Canvas 2D 水波实验',
      stack: 'Canvas 2D',
      status: '实验中',
      draft: true,
      sort: 10,
    });
    expect(createdDraft.status).toBe(201);
    const draftData = await j(createdDraft);
    expect(draftData).toMatchObject({
      slug: 'wave-sim',
      title: '流体波纹',
      draft: true,
      featured: false,
      entry: 'index.html',
    });

    const dup = await s.send('POST', '/api/lab', { slug: 'wave-sim', title: '重复' });
    expect(dup.status).toBe(409);
    expect((await j(dup)).error).toBe('slug_taken');

    const createdPub = await s.send('POST', '/api/lab', {
      slug: 'particle-orbit',
      title: '粒子轨道',
      stack: 'WebGL',
      draft: false,
      featured: true,
      sort: 5,
    });
    expect(createdPub.status).toBe(201);

    // Admin sees both (featured first); anonymous sees only published
    const adminList = await j(s.req('/api/lab'));
    expect(adminList.items.map((x: any) => x.slug)).toEqual(['particle-orbit', 'wave-sim']);

    const pubList = await j(s.app.request('/api/lab'));
    expect(pubList.items.map((x: any) => x.slug)).toEqual(['particle-orbit']);

    expect((await s.app.request('/api/lab/wave-sim')).status).toBe(404);
    expect((await s.req('/api/lab/wave-sim')).status).toBe(200);

    // Patch validation & update
    expect((await s.send('PATCH', '/api/lab/wave-sim', { slug: 'other' })).status).toBe(400);
    const patched = await s.send('PATCH', '/api/lab/wave-sim', { title: '流体波纹 v2', draft: false, sort: 1 });
    expect(patched.status).toBe(200);
    expect((await j(patched)).draft).toBe(false);
    expect((await j(s.app.request('/api/lab'))).items.map((x: any) => x.slug)).toEqual(['particle-orbit', 'wave-sim']);

    // Delete cleans up DB and directory
    const del = await s.req('/api/lab/wave-sim', { method: 'DELETE', headers: { origin: ORIGIN } });
    expect(del.status).toBe(204);
    expect((await s.req('/api/lab/wave-sim')).status).toBe(404);
    expect(fs.existsSync(path.join(s.dataDir, 'labs', 'wave-sim'))).toBe(false);
  });

  it('scaffolds a runnable blank lab when scaffold=true', async () => {
    const s = await authed();
    const res = await s.send('POST', '/api/lab', {
      slug: 'blank-demo',
      title: '空白<演示>',
      draft: false,
      scaffold: true,
    });
    expect(res.status).toBe(201);

    const filesRes = await j(s.req('/api/lab/blank-demo/files'));
    expect(filesRes.items.map((f: any) => f.path)).toEqual(['index.html', 'main.js', 'style.css']);

    const htmlFile = await j(s.req('/api/lab/blank-demo/file?path=index.html'));
    expect(htmlFile.content).toContain('<canvas id="stage"></canvas>');
    expect(htmlFile.content).toContain('<script type="module" src="./main.js"></script>');
    expect(htmlFile.content).toContain('空白&#60;演示&#62;');
    expect(htmlFile.content).not.toContain('<演示>');

    const jsFile = await j(s.req('/api/lab/blank-demo/file?path=main.js'));
    expect(jsFile.content).toContain('requestAnimationFrame');
  });

  it('extracts uploaded ZIP (stripping top folder & Mac junk), blocks traversal/disallowed exts, and exports ZIP', async () => {
    const s = await authed();
    await s.send('POST', '/api/lab', { slug: 'zip-lab', title: 'ZIP 实验', draft: false });

    // Empty lab exports valid empty ZIP
    const emptyExport = await s.req('/api/lab/zip-lab/export');
    expect(emptyExport.status).toBe(200);
    expect(emptyExport.headers.get('content-type')).toBe('application/zip');
    expect(emptyExport.headers.get('content-disposition')).toBe('attachment; filename="zip-lab.zip"');
    expect(emptyExport.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(unzipSync(new Uint8Array(await emptyExport.arrayBuffer())))).toEqual([]);

    // Reject path traversal
    const badZip = zipSync({
      '../escape.html': strToU8('<h1>bad</h1>'),
    });
    const badForm = new FormData();
    badForm.append('file', new File([badZip], 'bad.zip'));
    expect((await s.upload('/api/lab/zip-lab/upload', badForm)).status).toBe(400);

    // Reject disallowed extension
    const badExtZip = zipSync({
      'index.html': strToU8('<h1>ok</h1>'),
      'shell.sh': strToU8('echo hi'),
    });
    const badExtForm = new FormData();
    badExtForm.append('file', new File([badExtZip], 'bad-ext.zip'));
    expect((await s.upload('/api/lab/zip-lab/upload', badExtForm)).status).toBe(400);

    // Valid ZIP with single top-level directory, __MACOSX, .DS_Store, cover.webp, and custom html entry
    const goodZip = zipSync({
      'dist/__MACOSX/._demo.html': strToU8('junk'),
      'dist/.DS_Store': strToU8('junk'),
      'dist/demo.html': strToU8('<!doctype html><h1>Demo</h1><script src="./assets/app.js"></script>'),
      'dist/assets/app.js': strToU8('console.log("hi");'),
      'dist/cover.webp': new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    });
    const form = new FormData();
    form.append('file', new File([goodZip], 'bundle.zip'));
    const upRes = await s.upload('/api/lab/zip-lab/upload', form);
    expect(upRes.status).toBe(200);
    const upBody = await j(upRes);
    expect(upBody).toMatchObject({
      files: ['assets/app.js', 'cover.webp', 'demo.html'],
      entry: 'demo.html',
      cover: 'cover.webp',
    });

    // Export ZIP matches extracted files
    const expRes = await s.req('/api/lab/zip-lab/export');
    expect(expRes.status).toBe(200);
    const exported = unzipSync(new Uint8Array(await expRes.arrayBuffer()));
    expect(Object.keys(exported).sort()).toEqual(['assets/app.js', 'cover.webp', 'demo.html']);
    expect(strFromU8(exported['assets/app.js']!)).toBe('console.log("hi");');
  });

  it('manages text & binary files (list, read, put, upload asset, rename with entry/cover sync, delete)', async () => {
    const s = await authed();
    await s.send('POST', '/api/lab', { slug: 'file-lab', title: '文件管理', draft: false, scaffold: true });

    // PUT text file
    const putRes = await s.send('PUT', '/api/lab/file-lab/file', {
      path: 'shaders/frag.glsl',
      content: 'precision mediump float;\nvoid main() {}',
    });
    expect(putRes.status).toBe(200);
    expect((await j(putRes)).path).toBe('shaders/frag.glsl');

    // PUT blocks binary extension
    expect((await s.send('PUT', '/api/lab/file-lab/file', { path: 'tex.png', content: 'abc' })).status).toBe(400);

    // POST upload single binary asset (cover.png auto-fills cover)
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const coverForm = new FormData();
    coverForm.append('file', new File([pngBytes], 'cover.png'));
    const coverUp = await s.upload('/api/lab/file-lab/file', coverForm);
    expect(coverUp.status).toBe(200);
    expect(await j(coverUp)).toMatchObject({ path: 'cover.png', size: pngBytes.length, cover: 'cover.png' });

    // POST upload text file into nested path
    const txtForm = new FormData();
    txtForm.append('file', new File([strToU8('{"v":1}')], 'raw.txt'));
    txtForm.append('path', 'data/config.json');
    const txtUp = await s.upload('/api/lab/file-lab/file', txtForm);
    expect(txtUp.status).toBe(200);
    expect(await j(txtUp)).toMatchObject({ path: 'data/config.json' });

    // POST upload rejects disallowed extension
    const badUp = new FormData();
    badUp.append('file', new File([strToU8('bad')], 'malware.exe'));
    expect((await s.upload('/api/lab/file-lab/file', badUp)).status).toBe(400);

    // Read text vs binary
    const readText = await s.req('/api/lab/file-lab/file?path=data/config.json');
    expect(readText.status).toBe(200);
    expect(await j(readText)).toMatchObject({ path: 'data/config.json', content: '{"v":1}' });

    const readBin = await s.req('/api/lab/file-lab/file?path=cover.png');
    expect(readBin.status).toBe(200);
    expect(readBin.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await readBin.arrayBuffer())).toEqual(pngBytes);

    // Rename entry HTML -> updates entry automatically
    const renHtml = await s.send('POST', '/api/lab/file-lab/file/rename', {
      from: 'index.html',
      to: 'app.html',
    });
    expect(renHtml.status).toBe(200);
    expect(await j(renHtml)).toMatchObject({ path: 'app.html', entry: 'app.html', cover: 'cover.png' });

    // Rename cover -> updates cover automatically
    const renCover = await s.send('POST', '/api/lab/file-lab/file/rename', {
      from: 'cover.png',
      to: 'assets/cover.png',
    });
    expect(renCover.status).toBe(200);
    expect(await j(renCover)).toMatchObject({ path: 'assets/cover.png', entry: 'app.html', cover: 'assets/cover.png' });

    // Rename into existing target -> 409 conflict
    const conflict = await s.send('POST', '/api/lab/file-lab/file/rename', {
      from: 'main.js',
      to: 'style.css',
    });
    expect(conflict.status).toBe(409);
    expect((await j(conflict)).error).toBe('file_exists');

    // Rename missing source -> 404
    expect((await s.send('POST', '/api/lab/file-lab/file/rename', { from: 'none.js', to: 'x.js' })).status).toBe(404);

    // Rename nested file -> cleans up empty parent directory
    const renShader = await s.send('POST', '/api/lab/file-lab/file/rename', {
      from: 'shaders/frag.glsl',
      to: 'frag.glsl',
    });
    expect(renShader.status).toBe(200);
    expect(fs.existsSync(path.join(s.dataDir, 'labs', 'file-lab', 'shaders'))).toBe(false);

    // Delete file cleans empty directory and clears cover if deleted
    const delCover = await s.req('/api/lab/file-lab/file?path=assets/cover.png', { method: 'DELETE', headers: { origin: ORIGIN } });
    expect(delCover.status).toBe(204);
    expect(fs.existsSync(path.join(s.dataDir, 'labs', 'file-lab', 'assets'))).toBe(false);
    expect((await j(s.req('/api/lab/file-lab'))).cover).toBe('');
  });

  it('serves fullscreen /lab/:slug/ page, /lab-files/:slug/* with SAMEORIGIN, and updates /sitemap.xml', async () => {
    const s = await authed();
    await s.send('POST', '/api/lab', {
      slug: 'pub-lab',
      title: '公开实验',
      intro: '这是公开实验介绍',
      stack: 'WebGL · GLSL',
      draft: false,
      scaffold: true,
    });
    await s.send('POST', '/api/lab', {
      slug: 'draft-lab',
      title: '草稿实验',
      draft: true,
      scaffold: true,
    });

    // Public detail page (with and without trailing slash)
    for (const url of ['/lab/pub-lab', '/lab/pub-lab/']) {
      const pageRes = await s.app.request(url);
      expect(pageRes.status).toBe(200);
      expect(pageRes.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(pageRes.headers.get('cache-control')).toBe('public, max-age=60');
      const html = await pageRes.text();
      expect(html).toContain('<title>公开实验 · 试验场 · 拾光台</title>');
      expect(html).toContain('<meta name="description" content="这是公开实验介绍">');
      expect(html).toContain('<script defer src="/u/script.js" data-website-id="default"></script>');
      expect(html).toContain('<iframe id="lab-frame" src="/lab-files/pub-lab/index.html"');
      expect(html).toContain('class="lab-capsule"');
      expect(html).toContain('href="/lab/"');
      expect(html).toContain('WebGL · GLSL');
      expect(html).toContain('id="lab-fs"');
      expect(html).toContain('id="lab-toggle"');
    }

    // Draft detail page: 404 HTML for anon, 200 noindex for admin
    const anonDraftPage = await s.app.request('/lab/draft-lab/');
    expect(anonDraftPage.status).toBe(404);
    const anonDraftHtml = await anonDraftPage.text();
    expect(anonDraftHtml).toContain('href="/lab/"');

    const adminDraftPage = await s.req('/lab/draft-lab/');
    expect(adminDraftPage.status).toBe(200);
    expect(adminDraftPage.headers.get('cache-control')).toBe('no-store');
    const adminDraftHtml = await adminDraftPage.text();
    expect(adminDraftHtml).toContain('<meta name="robots" content="noindex">');
    expect(adminDraftHtml).not.toContain('/u/script.js');
    expect(adminDraftHtml).toContain('草稿');

    // /lab-files/:slug/* headers, MIME types, and draft gating
    const fileRes = await s.app.request('/lab-files/pub-lab/main.js');
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(fileRes.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(fileRes.headers.get('x-content-type-options')).toBe('nosniff');

    expect((await s.app.request('/lab-files/draft-lab/index.html')).status).toBe(404);
    expect((await s.req('/lab-files/draft-lab/index.html')).status).toBe(200);

    // /sitemap.xml includes published DB lab & fixture labs, excludes draft lab
    const sm = await (await s.app.request('/sitemap.xml')).text();
    expect(sm).toContain('<loc>https://blog.test/lab/end-of-time/</loc>');
    expect(sm).toContain('<loc>https://blog.test/lab/pub-lab/</loc>');
    expect(sm).not.toContain('/lab/draft-lab/');
  });

  it('round-trips labs metadata and files in full backup and rejects tampered lab entries safely', async () => {
    const source = await authed();
    await source.send('POST', '/api/lab', {
      slug: 'backup-lab',
      title: '备份实验',
      intro: '测试备份与恢复',
      stack: 'Canvas 2D',
      status: '完成',
      draft: false,
      featured: true,
      sort: -3,
      scaffold: true,
    });
    await source.send('PUT', '/api/lab/backup-lab/file', {
      path: 'extra/note.txt',
      content: 'hello backup',
    });

    const exportRes = await source.req('/api/private/backup/export');
    expect(exportRes.status).toBe(200);
    const zip = new Uint8Array(await exportRes.arrayBuffer());
    const files = unzipSync(zip);

    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as Record<string, any>;
    expect(manifest.counts.labs).toBe(1);
    expect(files['labs/backup-lab/index.html']).toBeDefined();
    expect(files['labs/backup-lab/main.js']).toBeDefined();
    expect(files['labs/backup-lab/style.css']).toBeDefined();
    expect(strFromU8(files['labs/backup-lab/extra/note.txt']!)).toBe('hello backup');

    const content = JSON.parse(strFromU8(files['content.json']!)) as Record<string, any>;
    expect(content.labs).toHaveLength(1);
    expect(content.labs[0]).toMatchObject({
      slug: 'backup-lab',
      title: '备份实验',
      featured: true,
      draft: false,
      sort: -3,
      entry: 'index.html',
    });

    // Restore into a fresh target instance
    const target = await authed();
    await target.send('POST', '/api/lab', { slug: 'old-lab', title: '会被替换', scaffold: true });

    const form = new FormData();
    form.append('file', new File([zip], 'backup.zip'));
    const importRes = await target.upload('/api/private/backup/import', form);
    expect(importRes.status).toBe(200);
    expect((await j(importRes)).labs).toBe(1);

    const restoredList = await j(target.req('/api/lab'));
    expect(restoredList.items.map((x: any) => x.slug)).toEqual(['backup-lab']);
    expect(restoredList.items[0]).toMatchObject({
      title: '备份实验',
      featured: true,
      sort: -3,
    });
    expect(fs.existsSync(path.join(target.dataDir, 'labs', 'old-lab'))).toBe(false);
    const note = await j(target.req('/api/lab/backup-lab/file?path=extra/note.txt'));
    expect(note.content).toBe('hello backup');

    // Backward compatibility: legacy backup without content.labs succeeds
    const legacyContent = { ...content };
    delete legacyContent.labs;
    const legacyEntries: Record<string, Uint8Array> = {
      'manifest.json': files['manifest.json']!,
      'content.json': strToU8(JSON.stringify(legacyContent)),
    };
    const legacyForm = new FormData();
    legacyForm.append('file', new File([zipSync(legacyEntries)], 'legacy.zip'));
    const legacyRes = await target.upload('/api/private/backup/import', legacyForm);
    expect(legacyRes.status).toBe(200);
    expect((await j(legacyRes)).labs).toBe(0);
    expect((await j(target.req('/api/lab'))).items.map((x: any) => x.slug)).toEqual(['backup-lab']);

    // Malformed lab file path in backup fails with 400 and does not mutate existing labs
    const evilZip = zipSync({
      ...files,
      'labs/backup-lab/../evil.html': strToU8('bad'),
    });
    const evilForm = new FormData();
    evilForm.append('file', new File([evilZip], 'evil.zip'));
    const evilRes = await target.upload('/api/private/backup/import', evilForm);
    expect(evilRes.status).toBe(400);
    expect((await j(target.req('/api/lab'))).items.map((x: any) => x.slug)).toEqual(['backup-lab']);
  });

  it('seeds built-in end-of-time experiment once and does not revive after deletion', async () => {
    const s = await authed();
    expect(seedBuiltinLabs(s.db, ':memory:', 1_700_000_000_000)).toBe(false);

    expect(seedBuiltinLabs(s.db, s.dataDir, 1_700_000_000_000)).toBe(true);
    expect(seedBuiltinLabs(s.db, s.dataDir, 1_700_000_000_000)).toBe(false);

    const detail = await j(s.req('/api/lab/end-of-time'));
    expect(detail).toMatchObject({
      slug: 'end-of-time',
      title: '时间的尽头',
      cover: '/lab/end-of-time-poster.webp',
      entry: 'index.html',
      featured: true,
      draft: false,
      sort: 10,
    });
    const filesRes = await j(s.req('/api/lab/end-of-time/files'));
    const paths = (filesRes.items as Array<{ path: string }>).map((f) => f.path);
    expect(paths).toEqual(['engine.js', 'index.html', 'main.js', 'shaders.js', 'style.css']);

    const delRes = await s.send('DELETE', '/api/lab/end-of-time');
    expect(delRes.status).toBe(204);
    expect(seedBuiltinLabs(s.db, s.dataDir, 1_700_000_000_000)).toBe(false);
    expect((await s.req('/api/lab/end-of-time')).status).toBe(404);
  });
});
