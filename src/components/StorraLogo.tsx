import type { CSSProperties } from 'react';

interface StorraLogoProps {
  size?: number;
  showText?: boolean;
  /** Текст-приписка под "Storra" (по умолчанию "WMS"). */
  tagline?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Вариант текста: 'compact' (рядом крупный Storra + маленький WMS)
   *                 или 'full' (Storra + полная подпись "Warehouse Management System").
   * По умолчанию compact — для шапки/сайдбара.
   */
  textVariant?: 'compact' | 'full';
}

/**
 * Логотип Storra — изометрическая «упаковочная коробка с пиктограммой коробки внутри»
 * и стрелка роста на заднем плане. Полностью вектор, чтобы был чёткий на любом размере
 * и в печати. Палитра — синий/бирюзовый градиент.
 *
 * Конструкция:
 *  • Скруглённый квадрат с градиентом — фон-«плашка».
 *  • На фоне диагональная стрелка вверх (символ «рост / отгрузка»).
 *  • На переднем плане — изометрическая коробка (символ «склад / товар»).
 *  • Внутри большой коробки — маленькая коробка-иконка (намёк на «WMS — управление товаром»).
 */
export function StorraLogo({
  size = 36,
  showText = true,
  tagline = 'WMS',
  className,
  style,
  textVariant = 'compact',
}: StorraLogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 ${className || ''}`} style={style}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Storra"
      >
        <defs>
          {/* Градиент плашки — от светло-голубого к тёмно-бирюзовому, как в исходном логотипе. */}
          <linearGradient id="storra-bg-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7cc4dc" />
            <stop offset="50%" stopColor="#5fb6d9" />
            <stop offset="100%" stopColor="#3a8ab0" />
          </linearGradient>
          {/* Градиент стрелки — еле заметный, на 30% непрозрачности. */}
          <linearGradient id="storra-arrow-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.45" />
          </linearGradient>
        </defs>

        {/* Скруглённая плашка-фон */}
        <rect x="0" y="0" width="200" height="200" rx="44" fill="url(#storra-bg-grad)" />

        {/* Диагональная стрелка вверх на заднем плане */}
        <path
          d="M 30 150 L 130 60 L 130 90 L 170 50 L 170 100 L 145 100 L 145 80 L 50 170 Z"
          fill="url(#storra-arrow-grad)"
        />

        {/* Изометрическая коробка (внешняя). 3 видимые грани */}
        {/* Верхняя крышка (ромб) */}
        <path
          d="M 100 50 L 155 78 L 100 106 L 45 78 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinejoin="round"
          opacity="0.95"
        />
        {/* Левая грань */}
        <path
          d="M 45 78 L 45 140 L 100 168 L 100 106 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinejoin="round"
          opacity="0.95"
        />
        {/* Правая грань */}
        <path
          d="M 155 78 L 155 140 L 100 168 L 100 106 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinejoin="round"
          opacity="0.95"
        />

        {/* Маленькая коробка внутри — пиктограмма «товар в коробке» */}
        <g transform="translate(78, 60) scale(0.45)">
          <path
            d="M 50 0 L 100 25 L 50 50 L 0 25 Z"
            fill="#ffffff"
            opacity="0.95"
          />
          <path
            d="M 0 25 L 0 75 L 50 100 L 50 50 Z"
            fill="#ffffff"
            opacity="0.65"
          />
          <path
            d="M 100 25 L 100 75 L 50 100 L 50 50 Z"
            fill="#ffffff"
            opacity="0.8"
          />
        </g>
      </svg>

      {showText && textVariant === 'compact' && (
        <div className="flex flex-col leading-none">
          <span
            className="font-extrabold tracking-tight"
            style={{ fontSize: Math.round(size * 0.6), color: '#1e3a5c', letterSpacing: '0.02em' }}
          >
            STORRA
          </span>
          {tagline && (
            <span
              className="font-semibold uppercase tracking-widest mt-1"
              style={{ fontSize: Math.max(8, Math.round(size * 0.2)), color: '#5ba9b8' }}
            >
              {tagline}
            </span>
          )}
        </div>
      )}

      {showText && textVariant === 'full' && (
        <div className="flex flex-col leading-none">
          <span
            className="font-extrabold tracking-tight"
            style={{ fontSize: Math.round(size * 0.7), color: '#1e3a5c', letterSpacing: '0.04em' }}
          >
            STORRA
          </span>
          <span
            className="font-medium mt-2"
            style={{ fontSize: Math.max(10, Math.round(size * 0.22)), color: '#5ba9b8', letterSpacing: '0.05em' }}
          >
            Warehouse Management System
          </span>
        </div>
      )}
    </div>
  );
}
