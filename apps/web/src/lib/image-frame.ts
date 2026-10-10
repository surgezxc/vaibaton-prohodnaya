export async function imageFileToFrame(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error("Выберите изображение JPEG или PNG.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Изображение больше 5 МБ. Выберите меньший файл.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Не удалось прочитать изображение.");
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить кадр.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Не удалось")) throw error;
    throw new Error("Файл повреждён или не является изображением.");
  } finally { URL.revokeObjectURL(url); }
}
