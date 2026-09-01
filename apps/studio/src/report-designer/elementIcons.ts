import { Type, Table2, Image as ImageIcon, Minus, Square, CalendarClock, Rows3, Barcode, QrCode, Grid3x3, BarChart3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ElementKind } from './types';

export const KIND_ICON: Record<ElementKind, LucideIcon> = {
  text: Type, table: Table2, image: ImageIcon, line: Minus, rect: Square, datetime: CalendarClock,
  keyvalue: Rows3, barcode: Barcode, qrcode: QrCode, cellgrid: Grid3x3, chart: BarChart3,
};
