/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        brand: { DEFAULT: 'hsl(var(--brand))', foreground: 'hsl(var(--brand-foreground))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      /*
       * Type scale, named after the design's pixel value at the default
       * 13px root (`--app-font-size`). Expressed in rem so the Settings
       * font-size control actually resizes text — with hardcoded px it only
       * grew the rem-based spacing around text that never changed.
       *
       * Keep names and values in lockstep: `fs-N` must equal N / 13 rem.
       * `fs-105` etc. are the half-steps the design uses (10.5px).
       */
      fontSize: {
        'fs-10': '0.7692rem',
        'fs-105': '0.8077rem',
        'fs-11': '0.8462rem',
        'fs-115': '0.8846rem',
        'fs-12': '0.9231rem',
        'fs-125': '0.9615rem',
        'fs-13': '1rem',
        'fs-14': '1.0769rem',
        'fs-15': '1.1538rem',
        'fs-16': '1.2308rem',
        'fs-18': '1.3846rem',
        'fs-21': '1.6154rem',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
      },
      boxShadow: {
        card: '0 1px 2px hsl(0 0% 0% / 0.04), 0 4px 16px hsl(0 0% 0% / 0.03)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
