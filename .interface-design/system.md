# MTG Deck Oracle Design System

## Direction
**Glassmorphism Dark UI** - A dark, immersive interface with frosted glass panels, subtle glows, and animated gradients. Designed for data-dense probability calculations with visual clarity.

## Foundation
- **Theme**: Dark with animated gradient backgrounds
- **Primary**: Deep Blue (#3b82f6)
- **Secondary**: Cyan (#06b6d4)
- **Glass Effect**: Translucent panels with backdrop blur

---

## Tokens

### Spacing
```
Base: 4px
Scale:
  --spacing-xs:  4px
  --spacing-sm:  8px
  --spacing-md:  12px
  --spacing-lg:  16px
  --spacing-xl:  20px
  --spacing-2xl: 24px
  --spacing-3xl: 32px
```

### Border Radius
```
--radius-sm:   6px
--radius-md:   10px
--radius-lg:   14px
--radius-xl:   18px
--radius-2xl:  24px
--radius-full: 9999px (pill)
```

### Colors

#### Backgrounds
```
--bg-dark:       #0f0f1a
--bg-gradient-1: #1a1a2e
--bg-gradient-2: #16213e
--bg-gradient-3: #0f3460
```

#### Glass Effects
```
--glass-bg:           rgba(255, 255, 255, 0.03)
--glass-bg-hover:     rgba(255, 255, 255, 0.06)
--glass-border:       rgba(255, 255, 255, 0.08)
--glass-border-hover: rgba(255, 255, 255, 0.15)
--glass-highlight:    rgba(255, 255, 255, 0.1)
--glass-shadow:       0 8px 32px rgba(0, 0, 0, 0.3)
--glass-blur:         10px
```

#### Text
```
--text-primary:   #e2e8f0
--text-secondary: #94a3b8
--text-muted:     #64748b
--text-dim:       #475569
--text-light:     #f1f5f9
```

#### Semantic
```
--success:       #22c55e
--success-light: #4ade80
--success-dark:  #15803d
--warning:       #f59e0b
--warning-light: #fbbf24
--danger:        #ef4444
--danger-light:  #f87171
--danger-dark:   #991b1b
--info:          #0ea5e9
--info-dark:     #0c4a6e
```

#### Choice Colors (Multiplayer UI)
```
--choice-purple:      #a855f7
--choice-purple-bg:   rgba(168, 85, 247, 0.1)
--choice-red:         #ef4444
--choice-red-bg:      rgba(239, 68, 68, 0.1)
--choice-blue:        #3b82f6
--choice-blue-bg:     rgba(59, 130, 246, 0.1)
```

#### MTG Card Types
```
--type-creature:     #22c55e
--type-sorcery:      #ef4444
--type-instant:      #3b82f6
--type-artifact:     #a8a29e
--type-enchantment:  #a855f7
--type-planeswalker: #f59e0b
--type-battle:       #ec4899
--type-land:         #78716c
```

### Transitions
```
--transition-fast:   0.15s ease
--transition-normal: 0.25s ease
--transition-slow:   0.4s ease
--transition-bounce: 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)
```

### Typography
```
--font-display: 'Cinzel', serif
--font-body:    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
--font-mono:    'SF Mono', 'Fira Code', 'Consolas', monospace
```

### Z-Index Layers
```
--z-base:     1
--z-dropdown: 100
--z-sticky:   200
--z-modal:    1000
--z-toast:    2000
```

---

## Patterns

### Panel (Primary Container)
```css
.panel {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);        /* 18px */
  padding: var(--spacing-xl);              /* 20px */
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight);
}

/* Hover: lift + glow */
.panel:hover {
  transform: translateY(-2px);
  border-color: var(--glass-border-hover);
  box-shadow: var(--glass-shadow), 0 0 20px var(--accent-glow);
}
```

### Button Primary
```css
.import-btn {
  padding: var(--spacing-md) var(--spacing-xl);  /* 12px 20px */
  border-radius: var(--radius-md);                /* 10px */
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%);
  border: none;
  color: var(--bg-dark);
  font-weight: 600;
  font-family: var(--font-display);
  box-shadow: 0 4px 12px var(--accent-glow);
}
```

### Button Icon
```css
.icon-btn {
  width: 40px;
  height: 40px;
  padding: 0;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);  /* 10px */
  color: var(--text-secondary);
}
```

### Navigation Tab
```css
.tab-group-btn {
  padding: var(--spacing-md) var(--spacing-lg);  /* 12px 16px */
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);                /* 10px */
  font-family: var(--font-display);
}

/* Active state */
.tab-group-btn.active {
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%);
  color: var(--bg-dark);
  box-shadow: 0 4px 16px var(--accent-glow);
}
```

### Navigation Pill
```css
.sub-nav-pill {
  padding: var(--spacing-sm) var(--spacing-lg);  /* 8px 16px */
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-full);              /* pill */
  font-size: 0.85rem;
}

.sub-nav-pill.active {
  background: var(--accent);
  color: var(--bg-dark);
  box-shadow: 0 2px 8px var(--accent-glow);
}
```

### Input Field
```css
.input-group input {
  width: 100%;
  padding: var(--spacing-md) var(--spacing-lg);  /* 12px 16px */
  border-radius: var(--radius-md);                /* 10px */
  background: var(--input-bg);                    /* rgba(0,0,0,0.3) */
  border: 1px solid var(--glass-border);
  color: var(--text-light);
  font-size: 1rem;
  min-height: 44px;                               /* touch-friendly */
}

.input-group input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
```

### Stat Card
```css
.stat-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  padding: var(--spacing-md);         /* 12px */
  border-radius: var(--radius-lg);    /* 14px */
}

.stat-card:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 8px 24px var(--accent-glow);
  border-color: var(--accent);
}
```

### Comparison Table
```css
.comparison-table th,
.comparison-table td {
  padding: var(--spacing-sm) var(--spacing-md);  /* 8px 12px */
  border: 1px solid var(--glass-border);
}

.comparison-table th {
  background: var(--glass-bg);
  color: var(--accent);
  text-transform: uppercase;
  font-size: 0.85rem;
}

.comparison-table tbody tr:nth-child(even) {
  background: var(--glass-bg);
}
```

### Insight Box
```css
.insight-box {
  border-radius: var(--radius-lg);    /* 14px */
  padding: var(--spacing-lg);          /* 16px */
  background: var(--theme-tint);
  border: 1px solid var(--glass-border);
}
```

### Toast Notification
```css
.toast {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  padding: var(--spacing-md) var(--spacing-xl);  /* 12px 20px */
  border-radius: var(--radius-full);              /* pill */
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}
```

### Opponent Tab (Multiplayer Calculators)
```css
.opponent-tab {
  padding: var(--spacing-sm) var(--spacing-md);   /* 8px 12px */
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);                /* 6px */
  font-size: 0.85em;
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.opponent-tab.active {
  background: var(--accent);
  color: var(--bg-dark);
  font-weight: 600;
}
```

### Choice Card (Multiplayer Results)
```css
.choice-card {
  padding: var(--spacing-sm);           /* 8px */
  border-radius: var(--radius-sm);      /* 6px */
  border-left: 3px solid var(--accent);
}

/* Variants: .choice-purple, .choice-red, .choice-blue */
```

### Summary Stats Box
```css
.summary-stats-box {
  margin-bottom: var(--spacing-lg);     /* 16px */
  padding: var(--spacing-md);           /* 12px */
  background: var(--glass-bg);
  border-radius: var(--radius-md);      /* 10px */
  border: 1px solid var(--glass-border);
}

.summary-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}
```

---

## Calculator Themes

Each calculator has its own accent color applied via body class:

| Calculator | Accent | CSS Class |
|------------|--------|-----------|
| Portent | Purple #8b5cf6 | `.theme-portent` |
| Surge | Green #22c55e | `.theme-surge` |
| Wave | Blue #0ea5e9 | `.theme-wave` |
| Vow | Emerald #10b981 | `.theme-vow` |
| Vortex | Orange #f97316 | `.theme-vortex` |
| Lands | Lime #84cc16 | `.theme-lands` |
| Mulligan | Deep Blue #3b82f6 | `.theme-mulligan` |
| Rashmi | Cyan #06b6d4 | `.theme-rashmi` |
| Lumra | Lime-green #65a30d | `.theme-lumra` |
| Mara | Red #dc2626 | `.theme-mara` |
| Dream Harvest | Navy #1e40af | `.theme-dreamharvest` |

Theme variables set per calculator:
```css
--accent: [color]
--accent-light: [lighter variant]
--accent-glow: [rgba for shadows]
--theme-tint: [subtle background tint]
```

---

## Depth Strategy

### Layering (bottom to top)
1. **Background**: Animated gradient
2. **Panels**: Glass bg + border + shadow + inset highlight
3. **Interactive elements**: Hover lift + glow
4. **Overlays/Modals**: Darker backdrop + blur

### Elevation cues
- **Rest**: 1px border, subtle shadow
- **Hover**: translateY(-2px), enhanced glow
- **Active/Pressed**: translateY(0), scale(0.98)
- **Focus**: 3px glow ring in accent color

---

## Responsive Behavior

### Breakpoints
- Desktop: > 900px
- Tablet: 640px - 900px
- Mobile: < 640px
- Small mobile: < 375px

### Mobile optimizations
- Reduced backdrop-filter blur (4-6px)
- Disabled hover transforms
- Touch targets min 44px
- Horizontal scroll for nav pills
- Sticky navigation

---

## Accessibility

- Focus visible: 2px solid accent + 2px offset
- Reduced motion: Disable animations
- Touch targets: Minimum 44x44px
- Color contrast: Text on dark backgrounds
- Screen reader only: `.sr-only` utility class
