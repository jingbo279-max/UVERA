import { supabase } from '../../api/supabaseClient';

// user_metadata key — must stay distinct from any future Avatar (digital persona)
// fields. "Profile picture" = small round head image. "Avatar" = creative asset.
export const PROFILE_PICTURE_KEY = 'profile_picture_url';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const OUTPUT_SIZE = 256;
const OUTPUT_QUALITY = 0.85;
const ACCEPT_MIME = 'image/png,image/jpeg,image/webp';

export function pickProfilePictureFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT_MIME;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

export async function fileToProfilePictureDataUrl(file) {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`Image too large (max ${MAX_INPUT_BYTES / 1024 / 1024}MB)`);
  }

  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Failed to read file'));
    r.readAsDataURL(file);
  });

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Failed to decode image'));
    i.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  const min = Math.min(img.width, img.height);
  const sx = (img.width - min) / 2;
  const sy = (img.height - min) / 2;
  ctx.drawImage(img, sx, sy, min, min, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL('image/jpeg', OUTPUT_QUALITY);
}

export async function uploadProfilePicture(file) {
  const dataUrl = await fileToProfilePictureDataUrl(file);
  const { error } = await supabase.auth.updateUser({
    data: { [PROFILE_PICTURE_KEY]: dataUrl },
  });
  if (error) throw error;
  return dataUrl;
}

export async function pickAndUploadProfilePicture() {
  const file = await pickProfilePictureFile();
  if (!file) return null;
  return await uploadProfilePicture(file);
}
