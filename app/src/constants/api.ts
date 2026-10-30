/**
 * Configuración de la API del backend.
 * La URL se puede sobreescribir con la variable EXPO_PUBLIC_API_URL
 * (por ejemplo http://192.168.x.x:3000 para desarrollo local).
 */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.riego.pipexapp.com';

export const DEFAULT_DEVICE_CODE = 'esp32-01';
