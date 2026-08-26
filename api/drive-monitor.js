const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxE4sXaG3r6CZArdGgFnelj8tai-urVpXJ_gjPHFapmBUhrDk-BK3-xd2oi-Tb-QLt9/exec';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const folderId = String(req.query.folderId || '').trim();
  const date = String(req.query.date || '').trim();

  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: 'INVALID_PARAMETERS' });
  }

  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('folderId', folderId);
    url.searchParams.set('date', date);

    const upstream = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'HINT-Drive-Monitor/1.0' }
    });

    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: 'UPSTREAM_ERROR', status: upstream.status });
    }

    const data = await upstream.json();
    const dateFolder = data.dateFolder || null;
    const dateFolderId = data.dateFolderId || (dateFolder && typeof dateFolder === 'object' ? dateFolder.id || dateFolder.folderId || null : null);
    const dateFolderUrl = data.dateFolderUrl || (dateFolder && typeof dateFolder === 'object' ? dateFolder.url || dateFolder.webViewLink || null : null);

    return res.status(200).json({
      ok: data.ok === true,
      completed: data.completed === true,
      status: data.status || (data.completed ? 'COMPLETE' : 'INCOMPLETE'),
      fileCount: Number.isFinite(Number(data.fileCount)) ? Number(data.fileCount) : 0,
      reason: data.reason || null,
      week: data.week || null,
      weekFolderId: data.weekFolderId || null,
      weekFolderUrl: data.weekFolderUrl || null,
      dateFolder,
      dateFolderId,
      dateFolderUrl
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'MONITOR_REQUEST_FAILED' });
  }
}
