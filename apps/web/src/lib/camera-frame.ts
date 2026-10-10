/** Кадр с того же video, что на экране. Без уменьшения и без чужого элемента. */
export async function grabCameraFrame(video: HTMLVideoElement, quality = 0.95): Promise<{ url: string; width: number; height: number } | null> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width < 32 || height < 32) return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(video);
  } catch {
    bitmap = null;
  }

  const sourceWidth = bitmap?.width || width;
  const sourceHeight = bitmap?.height || height;
  if (sourceWidth < 32 || sourceHeight < 32) {
    bitmap?.close();
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap?.close();
    return null;
  }
  if (bitmap) {
    context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
    bitmap.close();
  } else {
    context.drawImage(video, 0, 0, sourceWidth, sourceHeight);
  }

  const url = canvas.toDataURL("image/jpeg", quality);
  if (!url.startsWith("data:image/jpeg;base64,") || url.length < 500) return null;
  return { url, width: sourceWidth, height: sourceHeight };
}
