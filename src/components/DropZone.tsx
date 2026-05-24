import { Upload } from 'lucide-react';
import { type ReactNode,useCallback, useRef, useState } from 'react';

interface DropZoneProps {
  /** Какие расширения принимать. По умолчанию CSV. */
  accept?: string;
  /** Колбэк при выборе/перетаскивании файла. */
  onFile: (file: File) => void;
  /** Подсказка. */
  label?: ReactNode;
  className?: string;
}

/**
 * Универсальная зона для перетаскивания файлов с фоллбэком на input[type=file].
 * Подсвечивается синим при наведении файла.
 */
export function DropZone({ accept = '.csv,text/csv', onFile, label, className }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  return (
    <div
      onClick={() => fileRef.current?.click()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`
        cursor-pointer border-2 border-dashed rounded-xl px-4 py-6 text-center
        transition-all
        ${dragging
          ? 'border-nexus-accent bg-nexus-accent/10 scale-[1.01]'
          : 'border-nexus-border hover:border-nexus-accent/50 bg-nexus-surface2'}
        ${className || ''}
      `}
    >
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <Upload size={28} className={`mx-auto mb-2 ${dragging ? 'text-nexus-accent' : 'text-nexus-text3'}`} />
      <div className={`text-sm ${dragging ? 'text-nexus-accent2 font-medium' : 'text-nexus-text2'}`}>
        {label || 'Перетащите CSV сюда или нажмите для выбора файла'}
      </div>
    </div>
  );
}
