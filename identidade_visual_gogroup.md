# GoGroup - Design System & Identidade Visual para Frontend

> Documento de referencia obrigatoria para toda construcao de interface frontend do GoGroup.
> Extraido do modelo institucional oficial. Toda aplicacao, pagina ou componente deve seguir estas diretrizes.

---

## 1. Paleta de Cores

### Cores Primarias

| Token                  | Hex       | RGB              | Uso                                                     |
| ---------------------- | --------- | ---------------- | ------------------------------------------------------- |
| `--go-blue`            | `#0059A9` | `0, 89, 169`    | Cor principal da marca. Backgrounds, headers, CTAs.      |
| `--go-lime`            | `#D7DB00` | `215, 219, 0`   | Acento energetico. Botoes, badges, destaques, bordas.    |

### Cores de Superficie

| Token                  | Hex       | RGB              | Uso                                                     |
| ---------------------- | --------- | ---------------- | ------------------------------------------------------- |
| `--go-cream`           | `#FBF4EE` | `251, 244, 238` | Background principal de conteudo. Cards, paineis.        |
| `--go-light-blue`      | `#C7E9FD` | `199, 233, 253` | Background alternativo leve. Secoes claras, hovers.      |
| `--go-white`           | `#FFFFFF` | `255, 255, 255` | Texto sobre fundo escuro, areas de respiro.              |

### Cores de Texto

| Token                  | Hex       | RGB              | Uso                                                     |
| ---------------------- | --------- | ---------------- | ------------------------------------------------------- |
| `--go-text-primary`    | `#333333` | `51, 51, 51`    | Corpo de texto sobre fundo claro.                        |
| `--go-text-dark`       | `#000000` | `0, 0, 0`       | Texto de enfase ou legenda sobre fundo claro.            |
| `--go-text-on-blue`    | `#FFFFFF` | `255, 255, 255` | Texto sobre fundo `--go-blue`.                           |
| `--go-text-heading`    | `#0059A9` | `0, 89, 169`    | Titulos e headings sobre fundo claro.                    |

### CSS Variables (copiar para `:root`)

```css
:root {
  /* Primarias */
  --go-blue: #0059A9;
  --go-lime: #D7DB00;

  /* Superficies */
  --go-cream: #FBF4EE;
  --go-light-blue: #C7E9FD;
  --go-white: #FFFFFF;

  /* Texto */
  --go-text-primary: #333333;
  --go-text-dark: #000000;
  --go-text-on-blue: #FFFFFF;
  --go-text-heading: #0059A9;

  /* Semanticas (derivadas) */
  --go-bg-page: var(--go-cream);
  --go-bg-section-alt: var(--go-light-blue);
  --go-bg-hero: var(--go-blue);
  --go-accent: var(--go-lime);
  --go-border: var(--go-blue);
}
```

### Regras de Uso de Cor

1. **Contraste obrigatorio**: Texto sobre `--go-blue` sempre em `--go-white` ou `--go-lime`. Texto sobre `--go-cream` sempre em `--go-text-primary` ou `--go-text-heading`.
2. **Hierarquia**: `--go-blue` domina (heroi, header, footer). `--go-lime` e acento pontual (botoes, badges, tags). Nunca usar `--go-lime` como background de secoes inteiras.
3. **Proporcao na pagina**: Aproximadamente 55% azul/creme, 35% branco/light-blue, 10% lime. O lime e mais poderoso quando escasso.
4. **Dark mode**: Nao existe na identidade visual atual. Se necessario no futuro, `--go-blue` vira o background base e `--go-cream` se torna o tom de texto.

---

## 2. Tipografia

### Fonte Unica: Poppins (Google Fonts)

A marca usa exclusivamente **Poppins** em todos os materiais. Nenhuma outra fonte deve ser usada.

```html
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
```

### Escala Tipografica

| Nivel            | Peso          | Tamanho (desktop) | Tamanho (mobile) | Line-height | Letter-spacing | Uso                          |
| ---------------- | ------------- | ------------------ | ---------------- | ----------- | -------------- | ---------------------------- |
| Display / Hero   | Black (900)   | 48-64px            | 32-40px          | 1.1         | -0.02em        | Titulos de hero, capa        |
| H1               | ExtraBold (800) | 36-48px          | 28-32px          | 1.15        | -0.01em        | Titulo principal de pagina   |
| H2               | ExtraBold (800) | 28-36px          | 22-28px          | 1.2         | -0.01em        | Subtitulos de secao          |
| H3               | Bold (700)    | 20-24px            | 18-20px          | 1.3         | 0              | Titulos de card, subsecoes   |
| H4               | SemiBold (600) | 16-18px           | 15-16px          | 1.35        | 0              | Labels, categorias           |
| Body             | Regular (400) | 16px               | 15px             | 1.6         | 0.01em         | Texto corrido, paragrafos    |
| Body Small       | Regular (400) | 14px               | 13px             | 1.5         | 0.01em         | Texto secundario, legendas   |
| Caption          | Regular (400) | 12px               | 11px             | 1.4         | 0.02em         | Notas de rodape, metadata    |
| Label / Badge    | SemiBold (600) | 12-14px           | 11-13px          | 1.2         | 0.05em         | Badges, tags, pill labels    |
| Subtitulo (caps) | SemiBold (600) | 12-14px           | 11-12px          | 1.3         | 0.15em         | Subtitulos caixa alta        |

### CSS Variables Tipograficas

```css
:root {
  --font-family: 'Poppins', sans-serif;

  --fw-regular: 400;
  --fw-semibold: 600;
  --fw-bold: 700;
  --fw-extrabold: 800;
  --fw-black: 900;

  --fs-display: clamp(2rem, 5vw, 4rem);
  --fs-h1: clamp(1.75rem, 4vw, 3rem);
  --fs-h2: clamp(1.375rem, 3vw, 2.25rem);
  --fs-h3: clamp(1.125rem, 2vw, 1.5rem);
  --fs-h4: clamp(0.9375rem, 1.5vw, 1.125rem);
  --fs-body: clamp(0.9375rem, 1.2vw, 1rem);
  --fs-small: clamp(0.8125rem, 1vw, 0.875rem);
  --fs-caption: clamp(0.6875rem, 0.8vw, 0.75rem);
}
```

### Regras Tipograficas

1. **Titulos em azul**: Headings sobre fundo claro usam `--go-text-heading` (#0059A9). Sobre fundo azul, usam `--go-white`.
2. **Corpo em cinza escuro**: Nunca usar preto puro (#000) para paragrafos; usar `--go-text-primary` (#333).
3. **Subtitulos em caixa alta**: Quando o subtitulo acompanha um titulo hero, usar `text-transform: uppercase` com `letter-spacing: 0.15em` e peso SemiBold.
4. **Nunca misturar fontes**: Toda variacao vem do peso e tamanho, nao de familias diferentes.

---

## 3. Espacamento & Layout

### Sistema de Espacamento (base 8px)

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
  --space-10: 128px;
}
```

### Grid & Container

```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--space-5);
}

/* Grid padrao */
.grid {
  display: grid;
  gap: var(--space-5);
}

.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 768px) {
  .grid-2, .grid-3, .grid-4 {
    grid-template-columns: 1fr;
  }
}
```

### Secoes de Pagina

- Secao hero / destaque: `padding: var(--space-9) 0` (96px vertical)
- Secao de conteudo padrao: `padding: var(--space-8) 0` (64px vertical)
- Secao compacta: `padding: var(--space-7) 0` (48px vertical)
- Separacao entre elementos internos: `var(--space-5)` a `var(--space-6)` (24-32px)

---

## 4. Componentes Visuais

### 4.1. Border Radius

A identidade visual usa cantos arredondados generosos em tudo. O visual e suave e amigavel, nunca rigido ou agressivo.

```css
:root {
  --radius-sm: 8px;      /* Inputs, pequenos elementos */
  --radius-md: 12px;     /* Cards, paineis */
  --radius-lg: 16px;     /* Secoes destacadas, modals */
  --radius-xl: 24px;     /* Containers grandes, heros */
  --radius-pill: 9999px; /* Botoes, badges, tags */
}
```

### 4.2. Botoes

Os botoes da marca sao **pill-shaped** (totalmente arredondados), com tom energetico e presenca forte.

```css
/* Botao primario */
.btn-primary {
  font-family: var(--font-family);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-small);
  letter-spacing: 0.02em;
  background: var(--go-lime);
  color: var(--go-blue);
  border: none;
  border-radius: var(--radius-pill);
  padding: 12px 32px;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(215, 219, 0, 0.35);
}

/* Botao secundario */
.btn-secondary {
  font-family: var(--font-family);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-small);
  background: transparent;
  color: var(--go-white);
  border: 2px solid var(--go-white);
  border-radius: var(--radius-pill);
  padding: 10px 30px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.btn-secondary:hover {
  background: var(--go-white);
  color: var(--go-blue);
}

/* Botao sobre fundo claro */
.btn-outline-blue {
  font-family: var(--font-family);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-small);
  background: transparent;
  color: var(--go-blue);
  border: 2px solid var(--go-blue);
  border-radius: var(--radius-pill);
  padding: 10px 30px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.btn-outline-blue:hover {
  background: var(--go-blue);
  color: var(--go-white);
}
```

### 4.3. Cards

Cards seguem o padrao de fundo `--go-cream` com cantos arredondados, sem sombra pesada. A borda pode ser sutil ou inexistente.

```css
.card {
  background: var(--go-cream);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  border: none;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 32px rgba(0, 89, 169, 0.08);
}

/* Card sobre fundo azul */
.card-on-blue {
  background: var(--go-cream);
  border-radius: var(--radius-xl);
  padding: var(--space-7);
}

/* Card de destaque com borda lime */
.card-featured {
  background: var(--go-cream);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  border: 3px solid var(--go-lime);
}
```

### 4.4. Badges / Tags (Pill)

Formato de pastilha (pill), com texto compacto. Usados para categorias, status, labels.

```css
.badge {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-family);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-caption);
  letter-spacing: 0.05em;
  padding: 4px 16px;
  border-radius: var(--radius-pill);
}

.badge-lime {
  background: var(--go-lime);
  color: var(--go-blue);
}

.badge-blue {
  background: var(--go-blue);
  color: var(--go-white);
}

.badge-outline {
  background: transparent;
  color: var(--go-blue);
  border: 1.5px solid var(--go-blue);
}
```

### 4.5. Motivo "Browser Window" (3 Dots)

A identidade visual usa um motivo recorrente de "janela de navegador" com 3 circulos no canto superior esquerdo. Esse elemento deve ser usado como decoracao em heros, cards de destaque e secoes especiais.

```css
.browser-dots {
  display: flex;
  gap: 8px;
  padding: 16px;
}

.browser-dots::before,
.browser-dots::after,
.browser-dots span {
  content: '';
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--go-lime);
}

/* Uso: colocar dentro do header de um card ou hero panel */
```

### 4.6. Selo / Stamp Circular

A marca usa um selo circular com o "g" minusculo, como marca d'agua ou decoracao. Usar como elemento decorativo, nunca como botao funcional.

```css
.stamp {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 3px solid var(--go-blue);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-family);
  font-weight: var(--fw-black);
  font-size: 28px;
  color: var(--go-blue);
  background: var(--go-white);
}
```

---

## 5. Sombras & Elevacao

A identidade visual e limpa e plana. Sombras sao suaves e usadas com moderacao.

```css
:root {
  --shadow-sm: 0 2px 8px rgba(0, 89, 169, 0.06);
  --shadow-md: 0 4px 16px rgba(0, 89, 169, 0.08);
  --shadow-lg: 0 8px 32px rgba(0, 89, 169, 0.10);
  --shadow-lime-glow: 0 4px 20px rgba(215, 219, 0, 0.3);
}
```

---

## 6. Padroes de Layout de Pagina

### 6.1. Hero / Capa

Fundo `--go-blue`, painel arredondado (`--radius-xl`), borda ou fundo externo em `--go-lime`. Logo "gogroup" centralizado. Titulo abaixo em pill `--go-lime`. Subtitulo em caixa alta branca.

```
+-----------------------------------------------+
| [lime bg]                                      |
|  +-------------------------------------------+ |
|  | [3 dots]              [badge top-right]   | |
|  |                                           | |
|  |            gogroup (logo branco)          | |
|  |           [  Titulo aqui  ] (pill lime)   | |
|  |              SUBTITULO (caps branco)       | |
|  |                                           | |
|  +-------------------------------------------+ |
|                [blue panel radius-xl]          |
+-----------------------------------------------+
```

### 6.2. Pagina de Conteudo

Fundo `--go-blue` como moldura. Painel interno `--go-cream` com `--radius-xl`. Titulo `--go-text-heading`. Corpo `--go-text-primary`. Logo "gogroup" no canto inferior direito, discreto.

```
+-----------------------------------------------+
| [blue border/frame]                            |
|  +-------------------------------------------+ |
|  | [3 dots]                                  | |
|  |                                           | |
|  | Titulo aqui (heading azul, extrabold)     | |
|  |                                           | |
|  | Texto texto texto texto texto texto       | |
|  | texto texto texto texto texto             | |
|  |                                           | |
|  |                             gogroup logo  | |
|  +-------------------------------------------+ |
|                [cream panel radius-xl]         |
+-----------------------------------------------+
```

### 6.3. Variante Light Blue

Fundo `--go-lime` como moldura. Painel interno `--go-light-blue`. Mesma estrutura de conteudo. Usado para variacao visual entre secoes.

### 6.4. Secao de Depoimento / Testemunho

Card `--go-cream` com `--radius-xl`. Esquerda: foto/video. Direita: titulo em `--go-text-heading`, badge "Depoimento" em pill `--go-lime`, texto do depoimento. Selo circular "g" como decoracao. Ilustracoes (foguete, trofeu) como elementos decorativos opcionais.

### 6.5. Secao de Foto + Texto

Foto com `--radius-lg` na esquerda. Selo circular sobrepondo. Titulo grande `--go-text-heading` (Black 900). Texto corpo abaixo. Logo discreto no canto.

---

## 7. Ilustracoes & Iconografia

### Estilo de Ilustracao

A marca usa ilustracoes **cartoon/flat com tracos boldos**, linhas grossas, cores vibrantes (azul, amarelo, branco). O estilo e energetico, jovem e otimista.

Elementos recorrentes:
- Foguete decolando (inovacao, crescimento)
- Trofeu #1 (conquista, sucesso)
- Globo terrestre (alcance global, conexao)
- Estrelas e particulas (energia, destaque)

### Diretrizes para Icones

- Preferir icones com `stroke` (outline), nao preenchidos
- Stroke width: 2px
- Cantos arredondados nos icones (consistente com radius da marca)
- Cor primaria: `--go-blue`; acento: `--go-lime`
- Biblioteca sugerida: **Lucide Icons** ou **Phosphor Icons** (estilo rounded)

---

## 8. Animacoes & Micro-Interacoes

### Principios

1. **Suave e energetico**: Transicoes rapidas (200-400ms), easing ease-out. Nunca lento ou arrastado.
2. **Entrance com bounce sutil**: Elementos entrando na tela podem ter um leve overshoot (bounce).
3. **Hover com elevacao**: Cards e botoes sobem levemente (translateY) no hover.
4. **Sem exagero**: A marca e profissional. Animacoes decoram, nao distraem.

### CSS de Referencia

```css
/* Transicao padrao */
.transition-base {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Fade-in ao entrar na viewport */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-in {
  animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

/* Stagger para listas */
.stagger > *:nth-child(1) { animation-delay: 0ms; }
.stagger > *:nth-child(2) { animation-delay: 80ms; }
.stagger > *:nth-child(3) { animation-delay: 160ms; }
.stagger > *:nth-child(4) { animation-delay: 240ms; }
.stagger > *:nth-child(5) { animation-delay: 320ms; }

/* Hover scale sutil para elementos interativos */
.hover-lift {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.hover-lift:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}
```

---

## 9. Tom de Voz Visual

| Atributo       | Sim                                      | Nao                                      |
| -------------- | ---------------------------------------- | ---------------------------------------- |
| Cantos         | Arredondados, suaves, pill               | Quadrados, pontudos, sem radius          |
| Cores          | Azul intenso + lime energetico           | Cinza, pastel, tons mortos               |
| Tipografia     | Poppins bold/extrabold para titulos      | Fontes serifadas, thin, condensadas      |
| Layout         | Generoso, respirado, cards claros        | Comprimido, denso, sem espacamento       |
| Ilustracoes    | Cartoon bold, otimista, jovem            | Realista, corporativo frio, stock photo  |
| Interacoes     | Elevacao suave, transicoes rapidas       | Sem hover, animacoes longas/pesadas      |
| Tom geral      | Energetico, confiante, construtor        | Frio, distante, generico                 |

---

## 10. Tailwind CSS Config (se aplicavel)

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        go: {
          blue: '#0059A9',
          lime: '#D7DB00',
          cream: '#FBF4EE',
          'light-blue': '#C7E9FD',
        },
        text: {
          primary: '#333333',
          heading: '#0059A9',
        },
      },
      fontFamily: {
        poppins: ['Poppins', 'sans-serif'],
      },
      fontWeight: {
        regular: '400',
        semibold: '600',
        bold: '700',
        extrabold: '800',
        black: '900',
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        pill: '9999px',
      },
      boxShadow: {
        'go-sm': '0 2px 8px rgba(0, 89, 169, 0.06)',
        'go-md': '0 4px 16px rgba(0, 89, 169, 0.08)',
        'go-lg': '0 8px 32px rgba(0, 89, 169, 0.10)',
        'go-lime': '0 4px 20px rgba(215, 219, 0, 0.3)',
      },
    },
  },
};
```

---

## 11. Checklist de Validacao

Antes de entregar qualquer frontend GoGroup, verificar:

- [ ] Fonte e exclusivamente Poppins (todos os pesos carregados: 400, 600, 700, 800, 900)
- [ ] Cores usam as variaveis CSS definidas (nunca hardcoded fora dos tokens)
- [ ] Paleta limitada a: azul, lime, cream, light-blue, branco, cinza-texto
- [ ] Botoes sao pill-shaped (border-radius: 9999px)
- [ ] Cards tem border-radius generoso (12-24px)
- [ ] Titulos sao azul (#0059A9) sobre fundo claro, brancos sobre fundo azul
- [ ] Corpo de texto usa #333333, nunca preto puro
- [ ] Existe separacao visual clara entre secoes (moldura azul, fundo alternante)
- [ ] Elementos decorativos (3 dots, selo "g") presentes quando apropriado
- [ ] Hover states existem em todos elementos clicaveis
- [ ] Layout e generoso em espacamento, nunca comprimido
- [ ] Slogan "Construindo o Futuro" aparece quando aplicavel
- [ ] Responsivo: funciona em mobile, tablet e desktop
- [ ] Sem fontes genericas (Inter, Roboto, Arial, system-ui)
- [ ] Sem paletas genericas (purple gradients, cinza corporativo)

---

## 12. Exemplos de Aplicacao Rapida

### Header de Aplicacao

```html
<header style="background: var(--go-blue); padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; border-radius: 0 0 var(--radius-xl) var(--radius-xl);">
  <span style="font-family: 'Poppins'; font-weight: 800; font-size: 24px; color: var(--go-white);">gogroup</span>
  <nav style="display: flex; gap: 24px;">
    <a style="color: var(--go-white); font-family: 'Poppins'; font-weight: 600; text-decoration: none;">Home</a>
    <a style="color: var(--go-white); font-family: 'Poppins'; font-weight: 600; text-decoration: none;">Sobre</a>
    <button class="btn-primary">Contato</button>
  </nav>
</header>
```

### Secao Hero

```html
<section style="background: var(--go-lime); padding: 24px;">
  <div style="background: var(--go-blue); border-radius: var(--radius-xl); padding: 96px 48px; text-align: center; position: relative;">
    <div class="browser-dots" style="position: absolute; top: 24px; left: 24px;"></div>
    <h1 style="font-family: 'Poppins'; font-weight: 800; font-size: 48px; color: var(--go-white); margin-bottom: 24px;">gogroup</h1>
    <span class="badge-lime" style="font-size: 18px; padding: 12px 32px;">Construindo o Futuro</span>
  </div>
</section>
```

---

*Documento criado a partir da analise do modelo institucional oficial GoGroup. Versao 1.0 - Maio 2026.*
