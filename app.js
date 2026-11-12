/* ==========================================================================
   CENTRAL DE DADOS OPOVO+ | Controller Slim de Gabarito & Resoluções ENEM 2026
   Sistema Inteligente de Restrições Anti-Spoiler no Modo Treino
   ========================================================================== */

(function () {
  "use strict";

  const data = window.ENEM_DATA;
  if (!data || !data.provas) {
    console.error("ENEM_DATA não carregado.");
    return;
  }

  // URL Parameters
  const urlParams = new URLSearchParams(window.location.search);
  const rawProvaParam = (urlParams.get("prova") || "azul").toLowerCase();
  const initialProva = rawProvaParam === "verde" ? "rosa" : rawProvaParam;
  const initialMode = (urlParams.get("modo") || "gabarito").toLowerCase();
  const isModeLocked = urlParams.get("fixo") === "1" || urlParams.get("trava") === "1";
  const rawDiaParam = urlParams.get("dia");
  let initialDia = rawDiaParam === "2" ? 2 : rawDiaParam === "1" ? 1 : initialProva === "cinza" ? 2 : 1;

  // Verificação de ambiente embutido (iframe em portal jornalístico)
  const isEmbed = (function () {
    try {
      return window.self !== window.top || urlParams.get("embed") === "1";
    } catch (e) {
      return true;
    }
  })();

  const CORES_DIA = {
    1: ["azul", "rosa", "amarela", "branca"],
    2: ["azul", "rosa", "amarela", "cinza"]
  };

  // Application State
  const state = {
    diaAtual: initialDia,
    modo: ["gabarito", "treino"].includes(initialMode) ? initialMode : "gabarito",
    corAtual: CORES_DIA[initialDia].includes(initialProva) ? initialProva : "azul",
    areaFiltro: "todas",
    idiomaFiltro: "Inglês",
    buscaTermo: "",
    respostasAluno: carregarRespostas(),
    questoesReveladas: {}, // Para quando o aluno desbloquear sem responder
    questoesFiltradas: [],
    modalIndexAtual: -1,
    zoomNivel: 100
  };

  const PROVAS_MAP = {
    azul: { nome: "Prova Azul", color: "var(--cor-azul)", light: "var(--cor-azul-light)", border: "var(--cor-azul-border)" },
    rosa: { nome: "Prova Verde", color: "var(--cor-verde)", light: "var(--cor-verde-light)", border: "var(--cor-verde-border)" },
    amarela: { nome: "Prova Amarela", color: "var(--cor-amarela)", light: "var(--cor-amarela-light)", border: "var(--cor-amarela-border)" },
    branca: { nome: "Prova Branca", color: "var(--cor-branca)", light: "var(--cor-branca-light)", border: "var(--cor-branca-border)" },
    cinza: { nome: "Prova Cinza", color: "var(--cor-cinza)", light: "var(--cor-cinza-light)", border: "var(--cor-cinza-border)" }
  };

  // DOM Elements
  const root = document.documentElement;
  const body = document.body;
  if (isEmbed) {
    body.classList.add("is-embed");
  }
  if (isModeLocked) {
    root.classList.add("is-mode-locked");
    body.classList.add("is-mode-locked");
    const headerSub = document.querySelector(".header-exam-title .hide-on-mobile");
    if (headerSub && state.modo === "treino") {
      headerSub.textContent = "Gabarito Interativo ";
    }
  }
  const gridEl = document.getElementById("slimGrid");
  const inputSearch = document.getElementById("inputSearch");
  const modalRes = document.getElementById("modalResolution");
  const embedBackdrop = document.getElementById("embedModalBackdrop");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const scoreBar = document.getElementById("treinoScoreBar");
  const tabErros = document.getElementById("tabErros");
  const curtainEl = document.getElementById("modalSpoilerCurtain");

  function limparEstadoEmbedModal() {
    if (embedBackdrop) embedBackdrop.classList.remove("visible");
    if (modalRes) {
      modalRes.classList.remove("embed-positioned");
      modalRes.style.top = "";
      modalRes.style.height = "";
      modalRes.style.maxHeight = "";
    }
  }

  function fecharModal() {
    if (modalRes) {
      if (modalRes.open && typeof modalRes.close === "function") {
        try {
          modalRes.close();
        } catch (e) {}
      }
      modalRes.removeAttribute("open");
    }
    limparEstadoEmbedModal();
  }

  // Setup Light Dismiss for Dialog
  setupLightDismiss(modalRes);
  if (modalRes) {
    modalRes.addEventListener("close", limparEstadoEmbedModal);
  }
  if (embedBackdrop) {
    embedBackdrop.addEventListener("click", (e) => {
      e.stopPropagation();
      fecharModal();
    });
  }
  if (btnCloseModal) {
    btnCloseModal.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fecharModal();
    });
  }

  function setupLightDismiss(dialog) {
    if (!dialog) return;
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog || dialog.classList.contains("embed-positioned")) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;
      if (!inside) fecharModal();
    });
  }

  // Auto-resize dinâmico para embeds (seamless iframe)
  let resizeTimer = null;
  function notificarAlturaAoPai() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const header = document.querySelector(".slim-header");
      const main = document.querySelector("main");
      let h = 0;
      if (header && main) {
        h = Math.ceil(header.offsetHeight + main.offsetHeight + 40);
      } else {
        h = Math.ceil(document.body.scrollHeight || document.documentElement.scrollHeight || 0);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "enem-embed-resize", height: h }, "*");
      }
    }, 40);
  }

  // Persistence (LocalStorage)
  function carregarRespostas() {
    try {
      const raw = localStorage.getItem("opovo_enem_answers_2026");
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function obterChaveSlot(q, cor) {
    const diaQ = q.dia || state.diaAtual || 1;
    return `d${diaQ}_${cor || state.corAtual}_${q.numero}`;
  }

  function obterRespostaAluno(q, cor) {
    if (!q) return undefined;
    if (q.id_canonico && state.respostasAluno[q.id_canonico] !== undefined) {
      return state.respostasAluno[q.id_canonico];
    }
    const slotKey = obterChaveSlot(q, cor);
    return state.respostasAluno[slotKey];
  }

  function marcarRespostaQuestao(q, letra) {
    if (!q) return;
    const primaryKey = q.id_canonico || obterChaveSlot(q, state.corAtual);
    const slotKey = obterChaveSlot(q, state.corAtual);
    const atual = obterRespostaAluno(q, state.corAtual);

    if (atual === letra) {
      if (q.id_canonico) delete state.respostasAluno[q.id_canonico];
      delete state.respostasAluno[slotKey];
    } else {
      state.respostasAluno[primaryKey] = letra;
      if (q.id_canonico && slotKey !== q.id_canonico) {
        delete state.respostasAluno[slotKey];
      }
    }
    try {
      localStorage.setItem("opovo_enem_answers_2026", JSON.stringify(state.respostasAluno));
    } catch (e) {}

    atualizarPlacarTreino();
    renderizarCartao();

    if (modalRes.open && state.modalIndexAtual >= 0) {
      atualizarModal(state.modalIndexAtual);
    }
  }

  function limparRespostas() {
    const prova = data.provas[state.corAtual];
    if (prova) {
      prova.questoes.forEach((q) => {
        if ((q.dia || 1) !== state.diaAtual) return;
        if (q.id_canonico) {
          delete state.respostasAluno[q.id_canonico];
          delete state.questoesReveladas[q.id_canonico];
        }
        delete state.respostasAluno[obterChaveSlot(q, state.corAtual)];
      });
    }
    try {
      localStorage.setItem("opovo_enem_answers_2026", JSON.stringify(state.respostasAluno));
    } catch (e) {}
    atualizarPlacarTreino();
    renderizarCartao();
  }

  function contarPublicadasPorDia(cor, dia) {
    const prova = data.provas[cor];
    if (!prova) return 0;
    return prova.questoes.filter((q) => {
      if ((q.dia || 1) !== dia) return false;
      if (dia === 1 && q.sub_area === "Espanhol") return false;
      return q.publicada !== false;
    }).length;
  }

  function atualizarStatusDias() {
    const p1 = document.getElementById("day1StatusPill");
    const p2 = document.getElementById("day2StatusPill");
    const pubD1 = contarPublicadasPorDia(CORES_DIA[1].includes(state.corAtual) ? state.corAtual : "azul", 1);
    const pubD2Max = Math.max(...CORES_DIA[2].map((c) => contarPublicadasPorDia(c, 2)));

    if (p1) {
      p1.textContent = `${pubD1}/91`;
      p1.className = "day-status-pill is-ready";
    }
    if (p2) {
      if (pubD2Max <= 0) {
        p2.textContent = "Dom 18h";
        p2.className = "day-status-pill is-waiting";
      } else if (pubD2Max < 90) {
        p2.textContent = `${pubD2Max}/90`;
        p2.className = "day-status-pill is-live";
      } else {
        p2.textContent = "90/90";
        p2.className = "day-status-pill is-ready";
      }
    }

    const notice = document.getElementById("day2LiveNotice");
    const noticeText = document.getElementById("day2LiveText");
    const noticeDot = document.getElementById("day2LiveDot");
    const btnRefresh = document.getElementById("btnRefreshLive");
    if (notice && noticeText && noticeDot) {
      if (state.diaAtual !== 2) {
        notice.style.display = "none";
      } else {
        notice.style.display = "flex";
        const pubCor = contarPublicadasPorDia(state.corAtual, 2);
        const horaAtualizacao = (data.atualizado_em || "").slice(11, 16);
        noticeDot.className = "day2-live-dot";
        if (pubCor === 0) {
          noticeText.textContent = "Gabarito e resoluções comentadas do 2º Dia serão publicados neste domingo, a partir das 18h.";
        } else if (pubCor < 90) {
          noticeDot.classList.add("is-live");
          noticeText.textContent = `Apuração ao vivo • ${pubCor} de 90 questões publicadas (${PROVAS_MAP[state.corAtual].nome})${horaAtualizacao ? " • Atualizado às " + horaAtualizacao : ""}`;
        } else {
          noticeDot.classList.add("is-ready");
          noticeText.textContent = `2º Dia completo • 90 de 90 questões publicadas (${PROVAS_MAP[state.corAtual].nome})`;
        }
        if (btnRefresh) {
          btnRefresh.style.display = "inline-flex";
        }
      }
    }
  }

  function aplicarDia(dia) {
    state.diaAtual = dia === 2 ? 2 : 1;

    document.querySelectorAll(".day-tab-btn").forEach((btn) => {
      const isSelected = parseInt(btn.dataset.dia, 10) === state.diaAtual;
      btn.classList.toggle("active", isSelected);
      btn.setAttribute("aria-selected", isSelected ? "true" : "false");
    });

    // Alterna caderno Branca (Dia 1) <-> Cinza (Dia 2)
    if (state.diaAtual === 2 && state.corAtual === "branca") {
      state.corAtual = "cinza";
    } else if (state.diaAtual === 1 && state.corAtual === "cinza") {
      state.corAtual = "branca";
    }

    const btnBranca = document.querySelector('.exam-pill-btn[data-prova="branca"]');
    const btnCinza = document.querySelector('.exam-pill-btn[data-prova="cinza"]');
    if (btnBranca) btnBranca.style.display = state.diaAtual === 1 ? "flex" : "none";
    if (btnCinza) btnCinza.style.display = state.diaAtual === 2 ? "flex" : "none";

    // Atualiza filtros de área e seletor de idioma estrangeiro
    let filtroValido = state.areaFiltro === "todas" || state.areaFiltro === "erros";
    document.querySelectorAll(".filter-btn-slim[data-day-scope]").forEach((btn) => {
      const scope = parseInt(btn.dataset.dayScope, 10);
      const visivel = scope === state.diaAtual;
      btn.style.display = visivel ? "inline-block" : "none";
      if (visivel && btn.dataset.area === state.areaFiltro) {
        filtroValido = true;
      }
    });

    if (!filtroValido) {
      state.areaFiltro = "todas";
      document.querySelectorAll(".filter-btn-slim").forEach((t) => {
        t.classList.toggle("active", t.dataset.area === "todas");
      });
    }

    const langWrap = document.getElementById("langSwitchWrap");
    if (langWrap) {
      langWrap.style.display = state.diaAtual === 1 ? "inline-flex" : "none";
    }

    atualizarStatusDias();
    aplicarCorCaderno(state.corAtual);
    atualizarPlacarTreino();
    renderizarCartao();
  }

  // Atualiza Modo (Leitura vs Treino)
  function aplicarModo(modo) {
    if (isModeLocked && ["gabarito", "treino"].includes(initialMode)) {
      modo = initialMode;
    }
    state.modo = modo;
    body.classList.toggle("mode-gabarito", modo === "gabarito");

    document.querySelectorAll(".mode-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === modo);
    });

    if (modo === "treino") {
      scoreBar.classList.add("visible");
      tabErros.style.display = "inline-block";
    } else {
      scoreBar.classList.remove("visible");
      tabErros.style.display = "none";
      if (state.areaFiltro === "erros") {
        state.areaFiltro = "todas";
        document.querySelectorAll(".filter-btn-slim").forEach((t) => {
          t.classList.toggle("active", t.dataset.area === "todas");
        });
      }
    }

    renderizarCartao();

    if (modalRes.open && state.modalIndexAtual >= 0) {
      atualizarModal(state.modalIndexAtual);
    }
  }

  // Atualiza Cores do Caderno Selecionado
  function aplicarCorCaderno(cor) {
    const info = PROVAS_MAP[cor] || PROVAS_MAP.azul;
    root.style.setProperty("--exam-active-color", info.color);
    root.style.setProperty("--exam-active-light", info.light);
    root.style.setProperty("--exam-active-border", info.border);

    document.querySelectorAll(".exam-pill-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.prova === cor);
    });

    document.getElementById("sectionTitleLabel").textContent = `Caderno • ${info.nome} • ${state.diaAtual}º Dia`;
    atualizarStatusDias();
  }

  // Calculadora do Modo Treino
  function atualizarPlacarTreino() {
    const prova = data.provas[state.corAtual];
    if (!prova) return;

    let hits = 0;
    let misses = 0;
    let respondidas = 0;
    let publicadasDia = 0;

    prova.questoes.forEach((q) => {
      if ((q.dia || 1) !== state.diaAtual) return;
      if (q.numero === "RED") return;
      if ((q.sub_area === "Inglês" || q.sub_area === "Espanhol") && q.sub_area !== state.idiomaFiltro) {
        return;
      }

      if (q.gabarito) publicadasDia++;

      const marked = obterRespostaAluno(q, state.corAtual);
      if (marked) {
        respondidas++;
        if (q.gabarito) {
          if (marked === q.gabarito) hits++;
          else misses++;
        }
      }
    });

    const conferidas = hits + misses;
    const pct = conferidas > 0 ? Math.round((hits / conferidas) * 100) : 0;
    document.getElementById("scoreHits").textContent = hits === 1 ? "1 acerto" : `${hits} acertos`;
    document.getElementById("scoreMisses").textContent = misses === 1 ? "1 erro" : `${misses} erros`;
    if (publicadasDia === 0 && respondidas > 0) {
      document.getElementById("scoreTotal").textContent = `${respondidas} de 90 respondidas (aguardando gabarito)`;
    } else {
      document.getElementById("scoreTotal").textContent = `${respondidas} de 90 respondidas (${pct}%)`;
    }
  }

  // Filtra as Questões
  function obterQuestoesFiltradas() {
    const prova = data.provas[state.corAtual];
    if (!prova) return [];

    return prova.questoes.filter((q) => {
      if ((q.dia || 1) !== state.diaAtual) return false;

      if (q.sub_area === "Inglês" || q.sub_area === "Espanhol") {
        if (q.sub_area !== state.idiomaFiltro) return false;
      }

      if (state.areaFiltro === "linguagens") {
        if (!["Inglês", "Espanhol", "Língua Portuguesa e Literatura"].includes(q.sub_area)) return false;
      } else if (state.areaFiltro === "humanas") {
        if (q.sub_area !== "Ciências Humanas") return false;
      } else if (state.areaFiltro === "redacao") {
        if (q.sub_area !== "Redação") return false;
      } else if (state.areaFiltro === "natureza") {
        if (q.sub_area !== "Ciências da Natureza") return false;
      } else if (state.areaFiltro === "matematica") {
        if (q.sub_area !== "Matemática") return false;
      } else if (state.areaFiltro === "erros") {
        const resp = obterRespostaAluno(q, state.corAtual);
        if (!resp || !q.gabarito || resp === q.gabarito) return false;
      }

      if (state.buscaTermo.trim() !== "") {
        const t = state.buscaTermo.trim().toLowerCase();
        const matchNum = q.numero.toLowerCase().includes(t);
        const matchInt = parseInt(q.numero, 10) === parseInt(t, 10);
        if (!matchNum && !matchInt) return false;
      }

      return true;
    });
  }

  // Renderiza o Cartão-Resposta com Restrições Anti-Spoiler
  function renderizarCartao() {
    state.questoesFiltradas = obterQuestoesFiltradas();
    document.getElementById("sectionCountLabel").textContent = `${state.questoesFiltradas.length} itens`;

    if (state.questoesFiltradas.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-notice">
          Nenhuma questão encontrada para este filtro.
        </div>
      `;
      notificarAlturaAoPai();
      return;
    }

    const fragment = document.createDocumentFragment();

    state.questoesFiltradas.forEach((q, idx) => {
      const isPublicada = q.publicada !== false;
      const respAluno = obterRespostaAluno(q, state.corAtual);
      const isHit = respAluno && q.gabarito && respAluno === q.gabarito;
      const isMiss = respAluno && q.gabarito && respAluno !== q.gabarito;
      const isLiberada = isPublicada && (isHit || isMiss || (q.id_canonico && state.questoesReveladas[q.id_canonico]));

      // Redação (Sempre liberada)
      if (q.numero === "RED") {
        const rowRed = document.createElement("div");
        rowRed.className = "slim-row row-redacao";
        rowRed.dataset.index = String(idx);
        rowRed.innerHTML = `
          <div class="redacao-slim-flex">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="q-number-slim">RED</span>
              <div class="redacao-title">
                <strong>Proposta de Redação • ENEM 2026</strong>
                <p>Estrutura argumentativa e análise comentada dos professores do Farias Brito</p>
              </div>
            </div>
            <button type="button" class="btn-res-action" data-action="open-modal" data-index="${idx}">
              Ver análise
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        `;
        fragment.appendChild(rowRed);
        return;
      }

      // Linha Padrão
      const row = document.createElement("div");
      let rowStatusClass = "";
      if (!isPublicada) {
        rowStatusClass = "row-pending";
      } else if (state.modo === "treino") {
        if (isHit) rowStatusClass = "row-correct";
        else if (isMiss) rowStatusClass = "row-wrong";
      }
      row.className = `slim-row ${rowStatusClass}`;
      row.id = `row-${q.id_canonico || q.id}`;
      row.dataset.index = String(idx);

      // Bolhas A B C D E
      const bubblesHtml = ["A", "B", "C", "D", "E"]
        .map((letra) => {
          let cls = "bubble-slim";
          const disabledAttr = !isPublicada && state.modo === "gabarito" ? "disabled" : "";

          if (!isPublicada) {
            if (state.modo === "treino" && respAluno === letra) {
              cls += " student-picked";
            }
          } else if (state.modo === "gabarito") {
            if (letra === q.gabarito) {
              cls += " is-official-answer";
            }
          } else {
            if (respAluno === letra) {
              cls += letra === q.gabarito ? " student-hit" : " student-miss";
            } else if ((isMiss || (q.id_canonico && state.questoesReveladas[q.id_canonico])) && letra === q.gabarito) {
              cls += " reveal-correct";
            }
          }

          return `<button type="button" class="${cls}" ${disabledAttr} data-action="pick-bubble" data-index="${idx}" data-letra="${letra}" title="Alternativa ${letra}">${letra}</button>`;
        })
        .join("");

      // Botão de Resolução com Restrição no Modo Treino e Estado Pendente
      let btnResHtml = "";
      if (!isPublicada) {
        btnResHtml = `
          <button type="button" class="btn-res-action is-pending" disabled data-action="pending-res" title="Correção disponível após publicação do Farias Brito">
            Em breve
          </button>
        `;
      } else if (state.modo === "treino" && !isLiberada) {
        // Bloqueado até que o aluno responda
        btnResHtml = `
          <button type="button" class="btn-res-action is-locked" data-action="locked-res" data-index="${idx}" title="Responda para desbloquear a resolução">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Responder
          </button>
        `;
      } else {
        // Liberado
        btnResHtml = `
          <button type="button" class="btn-res-action" data-action="open-modal" data-index="${idx}" title="Ver resolução comentada">
            Resolução
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        `;
      }

      row.innerHTML = `
        <span class="q-number-slim">${q.numero}</span>

        <div class="bubbles-wrap-slim" role="group" aria-label="Questão ${q.numero}">
          ${bubblesHtml}
        </div>

        ${btnResHtml}
      `;

      fragment.appendChild(row);
    });

    gridEl.innerHTML = "";
    gridEl.appendChild(fragment);
    notificarAlturaAoPai();
  }

  function encontrarProximoIndicePublicado(indiceBase, direcao) {
    let i = indiceBase + direcao;
    while (i >= 0 && i < state.questoesFiltradas.length) {
      if (state.questoesFiltradas[i].publicada !== false) {
        return i;
      }
      i += direcao;
    }
    return -1;
  }

  // Modal de Resolução com Proteção de Cortina Anti-Spoiler & Design Slim
  function abrirModal(index) {
    if (index < 0 || index >= state.questoesFiltradas.length) return;
    if (state.questoesFiltradas[index].publicada === false) return;
    if (modalRes && (modalRes.open || modalRes.hasAttribute("open"))) {
      fecharModal();
    }
    state.modalIndexAtual = index;
    state.zoomNivel = 100;
    atualizarModal(index);

    // Posiciona o modal na área visível do embed sem depender de script no portal pai
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || body.classList.contains("is-fullscreen"));

    if (isEmbed && !isFs) {
      const rows = document.querySelectorAll(".slim-row");
      const targetRow = rows[index];
      const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, window.innerHeight, 1000);
      const baseH = window.innerWidth <= 640 ? 540 : 680;
      const fallbackTop = targetRow
        ? Math.max(8, Math.min(Math.round(targetRow.offsetTop - baseH * 0.4), docH - baseH - 8))
        : 20;

      modalRes.classList.add("embed-positioned");
      modalRes.style.top = fallbackTop + "px";
      modalRes.style.height = "";
      modalRes.style.maxHeight = "";
      if (embedBackdrop) embedBackdrop.classList.add("visible");
      modalRes.setAttribute("open", "");

      if (window.IntersectionObserver) {
        try {
          const io = new IntersectionObserver(
            (entries) => {
              io.disconnect();
              const entry = entries[0];
              if (!entry || !entry.isIntersecting || !modalRes.open || !modalRes.classList.contains("embed-positioned")) return;
              const visH = entry.intersectionRect.height;
              if (visH < 240) return;

              const visTop = entry.intersectionRect.top + window.scrollY;
              const visBottom = visTop + visH;
              if (targetRow && (targetRow.offsetTop < visTop - 220 || targetRow.offsetTop > visBottom + 220)) {
                return;
              }

              const fitH = Math.min(baseH, Math.max(320, Math.floor(visH - 28)));
              const idealTop = Math.round(visTop + (visH - fitH) / 2);
              const clampedTop = Math.max(8, Math.min(idealTop, docH - fitH - 8));
              modalRes.style.height = fitH + "px";
              modalRes.style.maxHeight = fitH + "px";
              modalRes.style.top = clampedTop + "px";
            },
            { threshold: 0 }
          );
          io.observe(document.body);
        } catch (e) {}
      }
    } else {
      limparEstadoEmbedModal();
      if (!modalRes.open) modalRes.showModal();
    }
    modalRes.scrollTop = 0;
    modalRes.scrollLeft = 0;
    const scrollBody = document.getElementById("modalViewerScroll");
    if (scrollBody) {
      scrollBody.scrollTop = 0;
      scrollBody.scrollLeft = 0;
    }
  }

  function atualizarModal(index) {
    const q = state.questoesFiltradas[index];
    if (!q) return;

    const canon = (q.id_canonico && data.repositorio_canonico[q.id_canonico]) || {};
    const pos = canon.posicoes_por_prova || {};
    const resp = obterRespostaAluno(q, state.corAtual);
    const isRedacao = q.numero === "RED";
    const isLiberada = isRedacao || state.modo === "gabarito" || resp !== undefined || (q.id_canonico && state.questoesReveladas[q.id_canonico] === true);

    // 1. Títulos e Badges
    document.getElementById("modalQuestaoTitle").textContent = isRedacao ? "Redação • Proposta Oficial" : `Questão ${q.numero}`;
    
    const examTag = document.getElementById("modalExamTag");
    if (examTag) {
      examTag.textContent = PROVAS_MAP[state.corAtual].nome;
      examTag.style.color = PROVAS_MAP[state.corAtual].color;
      examTag.style.background = PROVAS_MAP[state.corAtual].light;
      examTag.style.borderColor = PROVAS_MAP[state.corAtual].border;
    }

    const subAreaEl = document.getElementById("modalSubArea");
    if (subAreaEl) {
      subAreaEl.textContent = isRedacao ? "Redação" : q.sub_area;
    }

    // 2. Status do Gabarito no Topo com Restrições Estritas
    const pillGab = document.getElementById("modalGabaritoPill");
    pillGab.className = "modal-gab-status";

    if (isRedacao) {
      pillGab.classList.add("is-official");
      pillGab.textContent = "Tema & Análise FB";
    } else if (state.modo === "gabarito") {
      // Modo Leitura: exibe a resposta do Farias Brito diretamente
      pillGab.classList.add("is-official");
      pillGab.innerHTML = `Gabarito FB: <strong>${q.gabarito}</strong>`;
    } else {
      // Modo Treino (Simulado)
      if (!isLiberada) {
        // Bloqueado para evitar spoiler
        pillGab.classList.add("is-locked");
        pillGab.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Gabarito protegido (Modo Treino)
        `;
      } else if (resp) {
        // Aluno respondeu
        if (resp === q.gabarito) {
          pillGab.classList.add("is-hit");
          pillGab.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Você acertou! (Gabarito FB: <strong>${q.gabarito}</strong>)
          `;
        } else {
          pillGab.classList.add("is-miss");
          pillGab.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Você marcou ${resp} • Gabarito FB: <strong>${q.gabarito}</strong>
          `;
        }
      } else {
        // Revelado sem marcar
        pillGab.classList.add("is-official");
        pillGab.innerHTML = `Gabarito FB: <strong>${q.gabarito}</strong> (Revelado)`;
      }
    }

    // 3. Equivalência Compacta Inline entre Cadernos
    const equivContainer = document.getElementById("modalEquivTags");
    const CORES_SIGLAS = { azul: "AZ", rosa: "VD", amarela: "AM", branca: "BR", cinza: "CZ" };
    const coresEquiv = (q.dia || state.diaAtual) === 2 ? CORES_DIA[2] : CORES_DIA[1];
    equivContainer.innerHTML = coresEquiv
      .map((c) => {
        const num = pos[c] || "-";
        const info = PROVAS_MAP[c];
        const isActive = c === state.corAtual;
        const sigla = CORES_SIGLAS[c] || c.toUpperCase();
        return `
          <button type="button" class="equiv-pill ${isActive ? "active" : ""}" data-equiv-color="${c}" title="${info.nome}: Questão ${num}">
            <span class="equiv-dot" style="background:${info.color};"></span>
            <span>${sigla}:</span>
            <strong>${num}</strong>
          </button>
        `;
      })
      .join("");

    equivContainer.querySelectorAll("[data-equiv-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetColor = btn.dataset.equivColor;
        if (targetColor === state.corAtual) return;
        state.corAtual = targetColor;
        aplicarCorCaderno(targetColor);
        atualizarPlacarTreino();
        renderizarCartao();

        const novoIdx = state.questoesFiltradas.findIndex((it) => it.id_canonico === q.id_canonico);
        if (novoIdx >= 0) {
          state.modalIndexAtual = novoIdx;
          atualizarModal(novoIdx);
        }
      });
    });

    // 4. Bloqueio Rigoroso Anti-Spoiler e Exibição de Resolução
    const scrollBody = document.getElementById("modalViewerScroll");
    const sheetContainer = document.getElementById("resolutionSheetContainer");
    const img = document.getElementById("modalViewerImg");
    const localImg = q.arquivo_local || `imagens_resolucoes/${q.id_canonico}.gif`;

    if (state.modo === "treino" && !isLiberada) {
      // TRAVA TOTAL: Oculta a folha, zera a imagem e bloqueia 100% o scroll
      if (sheetContainer) sheetContainer.style.display = "none";
      if (img) img.src = "";
      if (scrollBody) {
        scrollBody.classList.add("is-locked");
        scrollBody.scrollTop = 0;
      }

      curtainEl.style.display = "flex";
      curtainEl.querySelectorAll("[data-curtain-letra]").forEach((btn) => {
        btn.onclick = () => {
          marcarRespostaQuestao(q, btn.dataset.curtainLetra);
        };
      });
      document.getElementById("btnCurtainBypass").onclick = () => {
        if (q.id_canonico) state.questoesReveladas[q.id_canonico] = true;
        atualizarModal(index);
        renderizarCartao();
      };
    } else {
      // LIBERADO (Modo Gabarito ou Questão respondida no Modo Treino):
      curtainEl.style.display = "none";
      if (scrollBody) {
        scrollBody.classList.remove("is-locked");
        scrollBody.scrollTop = 0;
      }
      if (sheetContainer) sheetContainer.style.display = "block";

      if (img) {
        img.style.opacity = "0";
        img.onload = function () {
          img.style.opacity = "1";
        };
        img.onerror = function () {
          if (img.src !== q.imagem_url && q.imagem_url) {
            img.src = q.imagem_url;
          } else {
            img.style.opacity = "1";
          }
        };
        img.removeAttribute("src");
        img.src = localImg;
        if (img.complete && img.naturalWidth > 0) img.style.opacity = "1";
      }

      aplicarZoom();
    }

    // Link de download do GIF
    document.getElementById("btnDownloadImage").href = localImg;
    document.getElementById("btnDownloadImage").download = `ENEM2026_D${q.dia || state.diaAtual}_${state.corAtual}_Q${q.numero}.gif`;

    // 5. Navegação e Contadores Ultra-Slim
    const prevIdx = encontrarProximoIndicePublicado(index, -1);
    const nextIdx = encontrarProximoIndicePublicado(index, 1);
    document.getElementById("btnPrevQuestao").disabled = prevIdx < 0;
    document.getElementById("btnNextQuestao").disabled = nextIdx < 0;
    document.getElementById("modalItemIndex").textContent = `${index + 1} / ${state.questoesFiltradas.length}`;
  }

  function aplicarZoom() {
    const sheet = document.getElementById("resolutionSheetContainer");
    if (sheet) {
      sheet.style.transform = `scale(${state.zoomNivel / 100})`;
      sheet.style.transformOrigin = "top center";
    }
    const zoomResetBtn = document.getElementById("btnZoomReset");
    if (zoomResetBtn) {
      zoomResetBtn.textContent = `${state.zoomNivel}%`;
    }
  }

  // Inicialização de Eventos
  function inicializarEventos() {
    // Resgate seguro de toque mobile: evita cliques perdidos por micro-deslize / compositor de iframe sem bloquear scroll
    const TAP_TARGET_SELECTOR = "button, .row-redacao, .q-number-slim, #embedModalBackdrop";
    const TAP_SLOP_PX = 12;
    const TAP_MAX_DURATION_MS = 500;
    const TAP_FALLBACK_DELAY_MS = 65;

    let tapStart = null;
    let touchSeq = 0;
    let nativeClickSeq = 0;
    let lastFallbackDispatch = { seq: -1, time: 0, x: 0, y: 0 };
    let isDispatchingFallback = false;

    document.addEventListener(
      "click",
      (e) => {
        if (!isDispatchingFallback) {
          if (
            e.isTrusted &&
            touchSeq === lastFallbackDispatch.seq &&
            Date.now() - lastFallbackDispatch.time < 450 &&
            Math.hypot((e.clientX || 0) - lastFallbackDispatch.x, (e.clientY || 0) - lastFallbackDispatch.y) < 35
          ) {
            lastFallbackDispatch.time = 0;
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
          }
          nativeClickSeq += 1;
        }
      },
      true
    );

    document.addEventListener(
      "touchstart",
      (e) => {
        touchSeq += 1;
        if (e.touches.length !== 1) {
          tapStart = null;
          return;
        }
        const rawTarget = e.target;
        if (rawTarget && rawTarget.closest && rawTarget.closest("input, select, textarea, a")) {
          tapStart = null;
          return;
        }
        const clickable = rawTarget && rawTarget.closest ? rawTarget.closest(TAP_TARGET_SELECTOR) : null;
        if (!clickable || (clickable.matches("button") && clickable.disabled)) {
          tapStart = null;
          return;
        }
        const t = e.touches[0];
        tapStart = {
          seq: touchSeq,
          seqAtStart: nativeClickSeq,
          target: clickable,
          x: t.clientX,
          y: t.clientY,
          time: Date.now(),
          moved: false,
        };
      },
      { passive: true }
    );

    document.addEventListener(
      "touchmove",
      (e) => {
        if (!tapStart || tapStart.moved || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > TAP_SLOP_PX) {
          tapStart.moved = true;
        }
      },
      { passive: true }
    );

    document.addEventListener(
      "touchcancel",
      () => {
        tapStart = null;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchend",
      (e) => {
        const snapshot = tapStart;
        tapStart = null;
        if (!snapshot || snapshot.moved || e.changedTouches.length !== 1) return;
        if (Date.now() - snapshot.time > TAP_MAX_DURATION_MS) return;

        const t = e.changedTouches[0];
        if (Math.hypot(t.clientX - snapshot.x, t.clientY - snapshot.y) > TAP_SLOP_PX) return;

        const targetEl = snapshot.target;
        const endX = t.clientX;
        const endY = t.clientY;

        setTimeout(() => {
          if (nativeClickSeq !== snapshot.seqAtStart) return;
          if (!document.contains(targetEl)) return;
          if (targetEl.matches("button") && targetEl.disabled) return;

          lastFallbackDispatch = { seq: snapshot.seq, time: Date.now(), x: endX, y: endY };
          isDispatchingFallback = true;
          try {
            targetEl.click();
          } finally {
            isDispatchingFallback = false;
          }
        }, TAP_FALLBACK_DELAY_MS);
      },
      { passive: true }
    );

    // Delegação única no cartão-resposta (evita falhas de re-clique e cliques em elementos internos)
    if (gridEl) {
      gridEl.addEventListener("click", (e) => {
        const bubbleBtn = e.target.closest('[data-action="pick-bubble"]');
        if (bubbleBtn) {
          e.stopPropagation();
          if (bubbleBtn.disabled) return;
          const bIdx = parseInt(bubbleBtn.dataset.index, 10);
          const qObj = !Number.isNaN(bIdx) ? state.questoesFiltradas[bIdx] : null;
          if (qObj) {
            marcarRespostaQuestao(qObj, bubbleBtn.dataset.letra);
          }
          return;
        }

        const resBtn = e.target.closest('[data-action="open-modal"], [data-action="locked-res"], .q-number-slim, .row-redacao');
        if (resBtn) {
          e.stopPropagation();
          const row = resBtn.classList.contains("slim-row") ? resBtn : resBtn.closest(".slim-row");
          if (row && row.classList.contains("row-pending")) return;
          const idxAttr = resBtn.dataset.index ?? row?.dataset.index;
          const idx = idxAttr !== undefined ? parseInt(idxAttr, 10) : -1;
          if (!Number.isNaN(idx) && idx >= 0) {
            abrirModal(idx);
          }
        }
      });
    }

    // Seletor de Dia (1º Dia vs 2º Dia)
    document.querySelectorAll(".day-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const novoDia = parseInt(btn.dataset.dia, 10);
        if (novoDia === 1 || novoDia === 2) {
          aplicarDia(novoDia);
        }
      });
    });

    const btnRefreshLive = document.getElementById("btnRefreshLive");
    if (btnRefreshLive) {
      btnRefreshLive.addEventListener("click", () => {
        window.location.reload();
      });
    }

    // Alternar Modo (Gabarito Oficial vs Modo Treino)
    document.querySelectorAll(".mode-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        aplicarModo(btn.dataset.mode);
      });
    });

    // Seletor de Caderno (Pills Slim)
    document.querySelectorAll(".exam-pill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        let canonicoAberto = null;
        if (modalRes.open && state.modalIndexAtual >= 0 && state.questoesFiltradas[state.modalIndexAtual]) {
          canonicoAberto = state.questoesFiltradas[state.modalIndexAtual].id_canonico;
        }

        state.corAtual = btn.dataset.prova;
        aplicarCorCaderno(state.corAtual);
        atualizarPlacarTreino();
        renderizarCartao();

        if (canonicoAberto) {
          const novoIdx = state.questoesFiltradas.findIndex((it) => it.id_canonico === canonicoAberto);
          if (novoIdx >= 0) {
            state.modalIndexAtual = novoIdx;
            atualizarModal(novoIdx);
          }
        }
      });
    });

    // Filtros de Área (Todas, Linguagens, Humanas, Redação, Erros)
    document.querySelectorAll(".filter-btn-slim").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn-slim").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        state.areaFiltro = tab.dataset.area;
        renderizarCartao();
      });
    });

    // Idioma Estrangeiro
    document.querySelectorAll(".lang-btn-slim").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".lang-btn-slim").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.idiomaFiltro = btn.dataset.lang;
        atualizarPlacarTreino();
        renderizarCartao();
      });
    });

    // Busca
    inputSearch.addEventListener("input", (e) => {
      state.buscaTermo = e.target.value;
      renderizarCartao();
    });

    // Botão "Revelar Gabarito" (Desbloqueia tudo no modo treino para o dia ativo)
    document.getElementById("btnRevealAll").addEventListener("click", () => {
      if (confirm(`Deseja revelar as respostas publicadas do ${state.diaAtual}º Dia no simulador?`)) {
        const prova = data.provas[state.corAtual];
        if (prova) {
          prova.questoes.forEach((q) => {
            if ((q.dia || 1) === state.diaAtual && q.id_canonico && q.publicada !== false) {
              state.questoesReveladas[q.id_canonico] = true;
            }
          });
        }
        renderizarCartao();
        if (modalRes.open && state.modalIndexAtual >= 0) {
          atualizarModal(state.modalIndexAtual);
        }
      }
    });

    // Reset de Respostas
    document.getElementById("btnResetScore").addEventListener("click", limparRespostas);

    // Alternância de Tela Cheia (Fullscreen API)
    function alternarTelaCheia() {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFs) {
        const root = document.documentElement;
        if (root.requestFullscreen) {
          root.requestFullscreen().catch((err) => {
            console.warn("Tela cheia indisponível ou bloqueada pelo iframe pai:", err);
          });
        } else if (root.webkitRequestFullscreen) {
          root.webkitRequestFullscreen();
        } else if (root.msRequestFullscreen) {
          root.msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }
    }

    const btnFsDesktop = document.getElementById("btnFullscreenDesktop");
    const btnFsMobile = document.getElementById("btnFullscreenMobile");
    if (btnFsDesktop) btnFsDesktop.addEventListener("click", alternarTelaCheia);
    if (btnFsMobile) btnFsMobile.addEventListener("click", alternarTelaCheia);

    function sincronizarEstadoTelaCheia() {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      document.body.classList.toggle("is-fullscreen", isFs);

      const labelDesktop = btnFsDesktop?.querySelector(".fullscreen-btn-label");
      if (labelDesktop) {
        labelDesktop.textContent = isFs ? "Restaurar" : "Tela cheia";
      }

      const tooltip = isFs ? "Sair da tela cheia (Esc)" : "Alternar tela cheia";
      if (btnFsDesktop) btnFsDesktop.title = tooltip;
      if (btnFsMobile) btnFsMobile.title = tooltip;

      if (isFs) {
        document.body.setAttribute("tabindex", "-1");
        document.body.focus();
      }

      if (modalRes && modalRes.open && state.modalIndexAtual >= 0) {
        const idxAtual = state.modalIndexAtual;
        fecharModal();
        abrirModal(idxAtual);
      }

      // Recalcula dimensões ao entrar ou sair de tela cheia
      setTimeout(() => notificarAlturaAoPai(), 150);
    }

    document.addEventListener("fullscreenchange", sincronizarEstadoTelaCheia);
    document.addEventListener("webkitfullscreenchange", sincronizarEstadoTelaCheia);

    // Controles do Modal de Resolução
    document.getElementById("btnPrevQuestao").addEventListener("click", () => {
      const prev = encontrarProximoIndicePublicado(state.modalIndexAtual, -1);
      if (prev >= 0) {
        state.modalIndexAtual = prev;
        atualizarModal(prev);
        document.getElementById("modalViewerScroll").scrollTop = 0;
      }
    });

    document.getElementById("btnNextQuestao").addEventListener("click", () => {
      const next = encontrarProximoIndicePublicado(state.modalIndexAtual, 1);
      if (next >= 0) {
        state.modalIndexAtual = next;
        atualizarModal(next);
        document.getElementById("modalViewerScroll").scrollTop = 0;
      }
    });

    document.getElementById("btnZoomIn").addEventListener("click", () => {
      state.zoomNivel = Math.min(state.zoomNivel + 15, 175);
      aplicarZoom();
    });

    document.getElementById("btnZoomOut").addEventListener("click", () => {
      state.zoomNivel = Math.max(state.zoomNivel - 15, 65);
      aplicarZoom();
    });

    document.getElementById("btnZoomReset").addEventListener("click", () => {
      state.zoomNivel = 100;
      aplicarZoom();
    });

    window.addEventListener("keydown", (e) => {
      if (!modalRes.open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        fecharModal();
      } else if (e.key === "ArrowLeft") {
        const prev = encontrarProximoIndicePublicado(state.modalIndexAtual, -1);
        if (prev >= 0) {
          state.modalIndexAtual = prev;
          atualizarModal(prev);
        }
      } else if (e.key === "ArrowRight") {
        const next = encontrarProximoIndicePublicado(state.modalIndexAtual, 1);
        if (next >= 0) {
          state.modalIndexAtual = next;
          atualizarModal(next);
        }
      }
    });

    // Navegação por Gesto de Swipe no Mobile
    let touchStartX = 0;
    let touchStartY = 0;
    const scrollEl = document.getElementById("modalViewerScroll");

    if (scrollEl) {
      scrollEl.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
          }
        },
        { passive: true }
      );

      scrollEl.addEventListener(
        "touchend",
        (e) => {
          if (e.changedTouches.length === 1) {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const diffX = touchEndX - touchStartX;
            const diffY = touchEndY - touchStartY;

            // Se o gesto for predominantemente horizontal e com deslocamento mínimo de 50px
            if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
              if (diffX < 0) {
                const next = encontrarProximoIndicePublicado(state.modalIndexAtual, 1);
                if (next >= 0) {
                  state.modalIndexAtual = next;
                  atualizarModal(next);
                  scrollEl.scrollTop = 0;
                }
              } else if (diffX > 0) {
                const prev = encontrarProximoIndicePublicado(state.modalIndexAtual, -1);
                if (prev >= 0) {
                  state.modalIndexAtual = prev;
                  atualizarModal(prev);
                  scrollEl.scrollTop = 0;
                }
              }
            }
          }
        },
        { passive: true }
      );
    }
  }

  // Início
  aplicarDia(state.diaAtual);
  aplicarModo(state.modo);
  inicializarEventos();
  gerenciarApresentacaoInicial();

  // ========================================================================
  // CONTROLADOR DA TELA DE SPLASH & ONBOARDING DE BOAS-VINDAS
  // ========================================================================
  function gerenciarApresentacaoInicial() {
    aplicarModo(state.modo || "gabarito");
    notificarAlturaAoPai();

    // Observa mudanças de dimensão para manter o iframe pai perfeitamente ajustado sem scrollbar
    if (window.ResizeObserver) {
      try {
        const ro = new ResizeObserver(() => notificarAlturaAoPai());
        ro.observe(document.body);
      } catch (e) {}
    }
    window.addEventListener("resize", notificarAlturaAoPai);
    window.addEventListener("load", notificarAlturaAoPai);
  }
})();
