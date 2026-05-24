import { Camera, RefreshCw,X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Сканер штрихкодов через камеру.
 *
 * Использует нативный `BarcodeDetector` API (Chrome/Edge/Samsung).
 * В Safari/Firefox при отсутствии API — показывает понятное сообщение и
 * предлагает использовать внешний сканер.
 *
 * Открывается как модалка поверх всего. По распознаванию — сразу закрывается
 * и возвращает строку штрихкода через onDetected.
 */

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
  /** Какие форматы пытаться распознать. По умолчанию популярные. */
  formats?: string[];
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

export function BarcodeScanner({ open, onClose, onDetected, formats }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelRef.current = false;
    setError(null);

    if (typeof window === 'undefined' || !window.BarcodeDetector) {
      setSupported(false);
      return;
    }
    setSupported(true);

    let detector: BarcodeDetectorLike | null = null;
    let stop = false;

    (async () => {
      try {
        const Ctor = window.BarcodeDetector!;
        detector = new Ctor({
          formats: formats || ['code_128', 'ean_13', 'ean_8', 'code_39', 'code_93', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'itf'],
        });

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Цикл распознавания: ~5 кадров/сек, чтобы не грузить процессор.
        while (!stop && !cancelRef.current) {
          await new Promise(r => setTimeout(r, 200));
          if (!videoRef.current || !detector) continue;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0) {
              const value = codes[0].rawValue;
              if (value) {
                cancelRef.current = true;
                onDetected(value);
                break;
              }
            }
          } catch { /* отдельные кадры — игнорим */ }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось получить доступ к камере');
      }
    })();

    return () => {
      stop = true;
      cancelRef.current = true;
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [open, onDetected, formats]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="absolute top-4 right-4 flex gap-2">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center"
          title="Закрыть"
        >
          <X size={22} />
        </button>
      </div>

      <div className="text-white text-lg font-bold mb-4 flex items-center gap-2">
        <Camera size={22} /> Наведите камеру на штрихкод
      </div>

      {supported === false && (
        <div className="bg-amber-900/90 border border-amber-700 text-amber-100 rounded-2xl p-6 max-w-md text-center">
          <div className="font-bold mb-2">Сканирование через камеру не поддерживается этим браузером</div>
          <div className="text-sm mb-4">Откройте приложение в Google Chrome / Edge на ПК или Android, либо подключите внешний USB/Bluetooth-сканер.</div>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium">
            Закрыть
          </button>
        </div>
      )}

      {supported && error && (
        <div className="bg-red-900/90 border border-red-700 text-red-100 rounded-2xl p-6 max-w-md text-center">
          <div className="font-bold mb-2">Ошибка камеры</div>
          <div className="text-sm mb-4">{error}</div>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-medium flex items-center gap-2 mx-auto">
            <RefreshCw size={14} /> Закрыть
          </button>
        </div>
      )}

      {supported && !error && (
        <div className="relative w-full max-w-xl aspect-[4/3] bg-black rounded-2xl overflow-hidden ring-2 ring-white/20">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          {/* Прицел */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-3/4 h-1/2 border-2 border-emerald-400/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          <div className="absolute bottom-3 left-0 right-0 text-center text-white/80 text-xs">
            Расположите код внутри рамки. Распознавание происходит автоматически.
          </div>
        </div>
      )}
    </div>
  );
}
