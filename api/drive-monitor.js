// Drive 업로드 확인(날짜·주차 폴더). 2기 Drive 구조를 아는 Apps Script 배포 주소는 Vercel 환경변수 HINT_DRIVE_MONITOR_URL에만 둡니다
// (1기 배포 주소는 쓰지 않음). cohort.json features.uploads가 꺼져 있거나 주소가 없으면 닫습니다.
import cohort from '../lib/cohort.cjs';
const monitorUrl = () => String(process.env.HINT_DRIVE_MONITOR_URL || '').trim();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!cohort.feature('uploads') || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(monitorUrl())) {
    return res.status(503).json({ ok: false, error: 'UPLOADS_NOT_OPEN', message: '2기 Drive 업로드 확인은 11월 중 2기 폴더 구조 기준으로 다시 엽니다.' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const folderId = String(req.query.folderId || '').trim();
  const date = String(req.query.date || '').trim();

  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: 'INVALID_PARAMETERS' });
  }

  try {
    const url = new URL(monitorUrl());
    url.searchParams.set('folderId', folderId);
    url.searchParams.set('date', date);

    const upstream = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'HINT-Drive-Monitor/1.1' }
    });

    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: 'UPSTREAM_ERROR', status: upstream.status });
    }

    const data = await upstream.json();
    const dateFolder = data.dateFolder || null;
    const dateFolderId = data.dateFolderId || (dateFolder && typeof dateFolder === 'object' ? dateFolder.id || dateFolder.folderId || null : null);
    const dateFolderUrl = data.dateFolderUrl || (dateFolder && typeof dateFolder === 'object' ? dateFolder.url || dateFolder.webViewLink || null : null);
    const files=(Array.isArray(data.files)?data.files:[]).map(f=>{
      const id=String(f?.fileId||f?.id||'');
      if(!id||!/^[A-Za-z0-9_-]{10,}$/.test(id))return null;
      return{
        fileId:id,
        name:String(f?.name||'파일'),
        mimeType:String(f?.mimeType||'application/octet-stream'),
        createdAt:String(f?.createdAt||''),
        updatedAt:String(f?.updatedAt||''),
        size:Number.isFinite(Number(f?.size))?Number(f.size):null,
        fileUrl:`https://drive.google.com/file/d/${id}/view`,
        previewUrl:`https://drive.google.com/file/d/${id}/preview`,
        imageUrl:`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`
      };
    }).filter(Boolean);

    return res.status(200).json({
      ok: data.ok === true,
      completed: data.completed === true,
      status: data.status || (data.completed ? 'COMPLETE' : 'INCOMPLETE'),
      fileCount: files.length || (Number.isFinite(Number(data.fileCount)) ? Number(data.fileCount) : 0),
      files,
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
