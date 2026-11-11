# Central de Dados OPOVO+ | Gabarito & Resoluções ENEM 2026

Aplicação interativa, moderna e ultra-slim para consulta de gabarito e treino de questões do ENEM 2026, desenvolvida para o portal **O POVO / OP+**.

---

## 🚀 Recursos Principais

1. **Aba Dupla (Ver Gabarito vs. Modo Treino):**
   * **Ver Gabarito:** Consulta rápida e direta com a alternativa oficial destacada na cor da prova.
   * **Modo Treino:** Respostas oficiais 100% ocultas. O leitor clica nas bolhas (A-E) e o sistema revela acertos (verde) e erros (vermelho) em tempo real, calculando pontuação e aproveitamento.
2. **Design Slim & Tipografia Vetorial:**
   * Tipografia jornalística em `Roboto Condensed`.
   * Logo vetorial em texto CSS puro (`CENTRAL DE DADOS OPOVO+`) com nitidez absoluta em telas retina e 4K.
   * Seletor de cadernos em *pills* compactas (Prova Azul, Prova Verde, Prova Amarela e Prova Branca).
3. **Autonomia de Imagens (96 fotos locais):**
   * Todas as resoluções comentadas do 1º Dia foram baixadas localmente para `imagens_resolucoes/`.
   * Fallback seguro para as URLs remotas em caso de arquivos faltantes.
4. **Calculadora & Filtros Rápidos:**
   * Alternância entre Inglês (01-05) e Espanhol (01-05).
   * Filtros por área: *Todas*, *Linguagens (01-45)*, *Ciências Humanas (46-90)*, *Redação* e *Meus Erros*.
5. **Modal com Zoom & Equivalência Canônica:**
   * Visualização da resolução comentada em alta definição.
   * Mapeamento automático de equivalência entre as 4 cores de prova.
   * Navegação fluida por botões e setas do teclado (`←` e `→`).

---

## 📁 Estrutura de Arquivos

```text
├── index.html                   # Estrutura HTML semântica com layout slim
├── style.css                    # Estilos CSS com design system OPOVO+
├── app.js                       # Controlador da lógica (Gabarito, Treino, Modais)
├── enem_data.js                 # Dados das questões em JS global (Zero CORS)
├── enem_provas_completo.json    # Base JSON com equivalência canônica
├── scraper_enem.py              # Extrator das 4 cores de prova do Farias Brito
├── download_images.py           # Downloader em lote das imagens em alta resolução
├── monitor_dia2.py              # Monitor automático para o 2º Dia do ENEM
└── imagens_resolucoes/          # Pasta com as imagens locais das questões (.gif)
```

---

## 🛠️ Comandos Rápidos

### Iniciar servidor de teste local:
```powershell
python -m http.server 8080
```
Acesse no navegador: `http://localhost:8080`

### Atualizar questões quando o 2º Dia sair:
```powershell
python scraper_enem.py && python download_images.py
```

### Deixar monitorando automaticamente:
```powershell
python monitor_dia2.py
```

---

## 💻 Como Inserir no Portal O POVO / OP+

Cole o código abaixo no CMS da matéria:

```html
<div style="width: 100%; max-width: 1200px; margin: 1.5rem auto; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04); background: #ffffff;">
  <iframe
    src="https://SEU-DOMINIO-OPOVO.com.br/gabarito-enem-2026/?prova=azul&modo=gabarito"
    width="100%"
    height="860"
    style="border: 0; display: block; width: 100%; min-height: 750px;"
    loading="lazy"
    title="Central de Dados OPOVO+ | Gabarito ENEM 2026"
  ></iframe>
</div>
```

