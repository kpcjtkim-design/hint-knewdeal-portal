// READ-ONLY ADD-ON FOR THE EXISTING DRIVE MONITOR
// This helper only reads file metadata. It never creates, renames, moves, edits or deletes Drive files.
// Add this file to the EXISTING Apps Script project that serves the current Drive monitor /exec URL.
// Then, in the object returned for a successfully found date folder, add:
//   files: dmPreviewFiles_(dateFolder)
// where `dateFolder` is the Folder object already found by the existing monitor logic.

function dmPreviewFiles_(dateFolder) {
  if (!dateFolder) return [];
  var out = [];
  var it = dateFolder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    out.push({
      fileId: f.getId(),
      name: f.getName(),
      mimeType: f.getMimeType(),
      createdAt: f.getDateCreated().toISOString(),
      updatedAt: f.getLastUpdated().toISOString(),
      size: f.getSize()
    });
  }
  out.sort(function(a, b) {
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
  return out;
}
