// Detach from the selected disk file before committing it to the workspace.
// Later file moves/edits must not invalidate saved originals or exports.
export async function copyUpload(file: File): Promise<File> {
  try {
    return new File([await file.arrayBuffer()], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch (cause) {
    throw new Error(`Could not read “${file.name}”. Select the file again.`, {
      cause,
    });
  }
}
