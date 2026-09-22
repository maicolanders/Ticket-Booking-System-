/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ---- Marquee Nights palette (dark, warm, theatrical) ------------- */
        ink: {
          DEFAULT: '#14101B', // page background (deep aubergine)
          950: '#0E0B14',
          900: '#14101B',
          800: '#1E1826', // panels / cards
          700: '#2A2133', // raised surfaces / inputs
          600: '#392E44', // borders / dividers
          500: '#4A3C57', // strong borders / hover borders
        },
        cream: {
          DEFAULT: '#F3EAD8', // primary text (warm white)
          muted: '#C7BBD0', // secondary text
          dim: '#938799', // tertiary / placeholder
        },
        brass: {
          DEFAULT: '#E0A44A', // primary accent — CTAs, selected seats
          bright: '#EFB965', // hover
          dark: '#B9822F', // pressed / borders
          deep: '#7A5518', // subtle fills
        },
        rose: {
          DEFAULT: '#E4573B', // alerts / danger / "almost sold out"
          bright: '#F06A50',
          dark: '#B23C26',
        },
        success: { DEFAULT: '#5DBE86', dark: '#2F6B4C' },
        warning: { DEFAULT: '#E8B04B', dark: '#8A6416' },
        info: { DEFAULT: '#7FA9D8', dark: '#3C5A7A' },
        /* Back-compat alias: existing `brand` utilities now render as brass. */
        brand: { DEFAULT: '#E0A44A', dark: '#B9822F' },
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'Cambria', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 30px -18px rgba(0,0,0,0.75)',
        pop: '0 24px 60px -20px rgba(0,0,0,0.8), 0 1px 0 0 rgba(255,255,255,0.04) inset',
        glow: '0 0 0 1px rgba(224,164,74,0.55), 0 0 26px -6px rgba(224,164,74,0.5)',
        'glow-sm': '0 0 18px -8px rgba(224,164,74,0.6)',
      },
      backgroundImage: {
        'hero-glow':
          'radial-gradient(1100px 520px at 50% -8%, rgba(224,164,74,0.22), transparent 60%), radial-gradient(700px 400px at 88% 4%, rgba(228,87,59,0.16), transparent 60%)',
        'brass-sheen': 'linear-gradient(135deg, #EFB965 0%, #E0A44A 45%, #B9822F 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
        'pulse-glow': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.5' } },
        'seat-pop': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.2,0.7,0.2,1) both',
        'fade-in': 'fade-in 0.4s ease both',
        'scale-in': 'scale-in 0.22s cubic-bezier(0.2,0.7,0.2,1) both',
        shimmer: 'shimmer 1.7s infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'seat-pop': 'seat-pop 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
