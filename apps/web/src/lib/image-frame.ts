export async function imageFileToFrame(file: File): Promise<string> {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Выберите изображение JPEG или PNG.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Изображение больше 5 МБ. Выберите меньший файл.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Не удалось прочитать изображение.");
    return await originalDataUrl(file);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Не удалось")) throw error;
    throw new Error("Файл повреждён или не является изображением.");
  } finally { URL.revokeObjectURL(url); }
}

function originalDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) resolve(reader.result);
      else reject(new Error("Не удалось прочитать изображение."));
    };
    reader.onerror = () => reject(new Error("Файл повреждён или не является изображением."));
    reader.readAsDataURL(file);
  });
}
