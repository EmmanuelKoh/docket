// config.js — single source for all environment-specific settings.
// Copy .env.example to .env and fill in your values, or export env vars directly.

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DejaVu TTFs are vendored in render/fonts so the render core works the same on
// macOS, Linux, and Vercel without a system font install. Override with FONT_DIR.
const BUNDLED_FONT_DIR = path.join(__dirname, 'render', 'fonts');

export const PRINTER_IP   = process.env.PRINTER_IP   || '192.168.1.87';
export const PRINTER_PORT = parseInt(process.env.PRINTER_PORT, 10) || 9100;
export const PRINT_WIDTH  = parseInt(process.env.PRINT_WIDTH, 10)  || 576;
export const FONT_DIR     = process.env.FONT_DIR     || BUNDLED_FONT_DIR;
