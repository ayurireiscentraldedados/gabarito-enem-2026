from datetime import datetime, timezone, timedelta
import json
import os
import re
import urllib.request
from bs4 import BeautifulSoup

BASE_URL = "https://comentarioenem.com.br/"
BRT = timezone(timedelta(hours=-3))

CORES_ORDEM = ["azul", "rosa", "amarela", "branca", "cinza"]
CORES_DIA1 = ["azul", "rosa", "amarela", "branca"]
CORES_DIA2 = ["azul", "rosa", "amarela", "cinza"]

CORES_INFO = {
    "azul": {"nome": "Prova Azul", "cor_hex": "#2563eb", "bg_hex": "#dbeafe", "dias": [1, 2]},
    "rosa": {"nome": "Prova Verde", "cor_hex": "#059669", "bg_hex": "#d1fae5", "dias": [1, 2]},
    "amarela": {"nome": "Prova Amarela", "cor_hex": "#d97706", "bg_hex": "#fef3c7", "dias": [1, 2]},
    "branca": {"nome": "Prova Branca", "cor_hex": "#475569", "bg_hex": "#f1f5f9", "dias": [1]},
    "cinza": {"nome": "Prova Cinza", "cor_hex": "#475569", "bg_hex": "#f1f5f9", "dias": [2]},
}


def extrair_dia_e_sub_area(imagem_rel, area_nome, numero_str):
    img = (imagem_rel or "").upper()
    area = (area_nome or "").upper()
    num_str = str(numero_str or "").strip().upper()
    num_int = int(num_str) if num_str.isdigit() else None

    if num_str == "RED" or img.startswith("1/") or "REDAÇÃO" in area or "REDACAO" in area:
        return 1, "Redação"
    if "0ING" in img:
        return 1, "Inglês"
    if "0ESP" in img:
        return 1, "Espanhol"
    if "0POR" in img or "LINGUAGENS" in area:
        return 1, "Língua Portuguesa e Literatura"
    if img.startswith("2/") or "HUMANAS" in area:
        return 1, "Ciências Humanas"
    if img.startswith("3/") or "3NAT" in img or "NATUREZA" in area:
        return 2, "Ciências da Natureza"
    if img.startswith("4/") or "4MAT" in img or "MATEM" in area:
        return 2, "Matemática"

    if num_int is not None:
        if 1 <= num_int <= 45:
            return 1, "Língua Portuguesa e Literatura"
        if 46 <= num_int <= 90:
            return 1, "Ciências Humanas"
        if 91 <= num_int <= 135:
            return 2, "Ciências da Natureza"
        if 136 <= num_int <= 180:
            return 2, "Matemática"

    return 1, "Geral"


def gerar_placeholders_dia2(cor_chave, existentes_numeros=None):
    """Garante os 90 slots (091-180) para cadernos do 2o Dia ainda nao publicados."""
    existentes = set(existentes_numeros or [])
    itens = []
    for n in range(91, 181):
        num_str = f"{n:03d}"
        if num_str in existentes:
            continue
        if n <= 135:
            area_nome = "CIÊNCIAS DA NATUREZA E SUAS TECNOLOGIAS"
            sub_area = "Ciências da Natureza"
        else:
            area_nome = "MATEMÁTICA E SUAS TECNOLOGIAS"
            sub_area = "Matemática"
        itens.append({
            "id": f"{cor_chave}_d2_{num_str}",
            "id_canonico": None,
            "dia": 2,
            "numero": num_str,
            "gabarito": None,
            "publicada": False,
            "area": area_nome,
            "sub_area": sub_area,
            "imagem_rel": "",
            "imagem_url": "",
            "arquivo_local": "",
            "dimensoes": {"largura": None, "altura": None},
        })
    return itens


def carregar_backup_anterior(caminho_json="enem_provas_completo.json"):
    if not os.path.exists(caminho_json):
        return None
    try:
        with open(caminho_json, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def parsear_html_prova(html, cor_chave):
    soup = BeautifulSoup(html, "html.parser")
    questoes_sec = soup.find("section", id="questoes")
    if not questoes_sec:
        return []

    materias_divs = questoes_sec.find_all("div", class_=re.compile(r"\bmateria\b"))
    lista_questoes = []

    for m in materias_divs:
        nome_mat_el = m.find("div", class_="nome-materia")
        if nome_mat_el:
            alerta = nome_mat_el.find("span", class_="alerta")
            alerta_txt = alerta.get_text(strip=True) if alerta else ""
            raw_area = nome_mat_el.get_text(" ", strip=True)
            area_nome = raw_area.replace(alerta_txt, "").strip()
        else:
            area_nome = "Geral"

        blocos_q = m.find_all("div", class_="numero-questao")
        for div_q in blocos_q:
            a = div_q.find("a")
            if a:
                href = a.get("href", "")
                text = a.get_text(" ", strip=True)
                onclick = a.get("onclick", "")

                tokens = text.split()
                numero = tokens[0] if len(tokens) > 0 else ""
                gabarito = tokens[1] if len(tokens) > 1 else ""

                if numero.isdigit():
                    numero = numero.zfill(3)

                img_param = re.search(r"imagem=([^&]+)", href)
                w_param = re.search(r"width=(\d+)", onclick)
                h_param = re.search(r"height=(\d+)", onclick)

                imagem_rel = img_param.group(1) if img_param else ""
                imagem_url = f"{BASE_URL}arquivos/questoes/{imagem_rel}" if imagem_rel else ""

                dia, sub_area = extrair_dia_e_sub_area(imagem_rel, area_nome, numero)
                ext = os.path.splitext(imagem_rel)[1].lower() or ".gif"
                id_canonico = re.sub(r"\.[^.]+$", "", imagem_rel.replace("/", "_")) if imagem_rel else f"d{dia}_{cor_chave}_{numero}"
                arquivo_local = f"imagens_resolucoes/{id_canonico}{ext}" if imagem_rel else ""

                lista_questoes.append({
                    "id": f"{cor_chave}_{numero}_{id_canonico}",
                    "id_canonico": id_canonico,
                    "dia": dia,
                    "numero": numero,
                    "gabarito": gabarito if gabarito else None,
                    "publicada": bool(imagem_rel),
                    "area": area_nome,
                    "sub_area": sub_area,
                    "imagem_rel": imagem_rel,
                    "imagem_url": imagem_url,
                    "arquivo_local": arquivo_local,
                    "dimensoes": {
                        "largura": int(w_param.group(1)) if w_param else None,
                        "altura": int(h_param.group(1)) if h_param else None,
                    },
                })
            else:
                raw_num = div_q.get_text(strip=True)
                if not raw_num or not raw_num.isdigit():
                    continue
                numero = raw_num.zfill(3)
                dia, sub_area = extrair_dia_e_sub_area("", area_nome, numero)
                lista_questoes.append({
                    "id": f"{cor_chave}_d{dia}_{numero}",
                    "id_canonico": None,
                    "dia": dia,
                    "numero": numero,
                    "gabarito": None,
                    "publicada": False,
                    "area": area_nome,
                    "sub_area": sub_area,
                    "imagem_rel": "",
                    "imagem_url": "",
                    "arquivo_local": "",
                    "dimensoes": {"largura": None, "altura": None},
                })

    return lista_questoes


def completar_slots_dia2(lista_questoes, cor_chave):
    """Assegura que cadernos do 2o Dia tenham sempre os 90 numeros (091-180) ordenados."""
    if cor_chave not in CORES_DIA2:
        return lista_questoes

    existentes_d2 = {
        q["numero"] for q in lista_questoes if q.get("dia") == 2 and str(q.get("numero", "")).isdigit()
    }
    faltantes = gerar_placeholders_dia2(cor_chave, existentes_d2)
    combinada = lista_questoes + faltantes

    def sort_key(q):
        dia = q.get("dia", 1)
        num = str(q.get("numero", ""))
        if num == "RED":
            return (1, 45.5, 0)
        n_int = int(num) if num.isdigit() else 999
        lang_ord = 0 if q.get("sub_area") == "Inglês" else (1 if q.get("sub_area") == "Espanhol" else 2)
        return (dia, n_int, lang_ord)

    return sorted(combinada, key=sort_key)


def salvar_atomico(caminho, conteudo):
    tmp = f"{caminho}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(conteudo)
    os.replace(tmp, caminho)


def coletar_todas_as_provas():
    backup = carregar_backup_anterior()
    agora_brt = datetime.now(BRT).isoformat(timespec="seconds")

    dados_finais = {
        "atualizado_em": agora_brt,
        "ano": 2026,
        "dias_disponiveis": [1, 2],
        "cores_disponiveis": CORES_ORDEM,
        "cores_por_dia": {
            "1": CORES_DIA1,
            "2": CORES_DIA2,
        },
        "cores_info": CORES_INFO,
        "provas": {},
        "repositorio_canonico": {},
        "estatisticas": {},
    }

    for cor_chave in CORES_ORDEM:
        url = f"{BASE_URL}?prova={cor_chave}"
        print(f"Coletando {cor_chave} -> {url}...")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})

        lista_questoes = None
        try:
            html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="ignore")
            parsed = parsear_html_prova(html, cor_chave)

            if len(parsed) == 0 and cor_chave in CORES_DIA1 and backup and cor_chave in backup.get("provas", {}):
                print(f"Aviso: resposta vazia para {cor_chave}. Mantendo backup anterior.")
                lista_questoes = backup["provas"][cor_chave].get("questoes", [])
            else:
                lista_questoes = completar_slots_dia2(parsed, cor_chave)
                pub_d1 = sum(1 for q in lista_questoes if q.get("dia") == 1 and q.get("publicada"))
                pub_d2 = sum(1 for q in lista_questoes if q.get("dia") == 2 and q.get("publicada"))
                print(f"Sucesso: {cor_chave} -> {len(lista_questoes)} slots (Dia 1 pub: {pub_d1}, Dia 2 pub: {pub_d2})")

        except Exception as e:
            print(f"Erro ao processar {cor_chave}: {e}")
            if backup and cor_chave in backup.get("provas", {}):
                print(f"Usando dados em cache de {cor_chave} para evitar perda.")
                lista_questoes = completar_slots_dia2(backup["provas"][cor_chave].get("questoes", []), cor_chave)
            else:
                lista_questoes = completar_slots_dia2([], cor_chave)

        for item in lista_questoes:
            id_can = item.get("id_canonico")
            if not id_can or not item.get("publicada"):
                continue

            if id_can not in dados_finais["repositorio_canonico"]:
                dados_finais["repositorio_canonico"][id_can] = {
                    "id_canonico": id_can,
                    "dia": item.get("dia", 1),
                    "gabarito_oficial_extra": item.get("gabarito"),
                    "sub_area": item.get("sub_area"),
                    "imagem_url": item.get("imagem_url"),
                    "arquivo_local": item.get("arquivo_local"),
                    "dimensoes": item.get("dimensoes"),
                    "posicoes_por_prova": {},
                }
            dados_finais["repositorio_canonico"][id_can]["posicoes_por_prova"][cor_chave] = item["numero"]

        dados_finais["provas"][cor_chave] = {
            "cor_chave": cor_chave,
            "label": CORES_INFO[cor_chave]["nome"],
            "dias": CORES_INFO[cor_chave]["dias"],
            "total_questoes": len(lista_questoes),
            "questoes": lista_questoes,
        }

    # Estatísticas detalhadas por dia e caderno
    est_d1 = {}
    for c in CORES_DIA1:
        qs = dados_finais["provas"].get(c, {}).get("questoes", [])
        # Contabiliza itens únicos do Dia 1 considerando Inglês ou Espanhol (91)
        est_d1[c] = sum(1 for q in qs if q.get("dia") == 1 and q.get("publicada") and q.get("sub_area") != "Espanhol")

    est_d2 = {}
    for c in CORES_DIA2:
        qs = dados_finais["provas"].get(c, {}).get("questoes", [])
        est_d2[c] = sum(1 for q in qs if q.get("dia") == 2 and q.get("publicada"))

    dados_finais["estatisticas"] = {
        "dia1": {
            "total": 91,
            "publicadas": max(est_d1.values()) if est_d1 else 0,
            "por_cor": est_d1,
        },
        "dia2": {
            "total": 90,
            "publicadas": max(est_d2.values()) if est_d2 else 0,
            "por_cor": est_d2,
        },
    }

    caminho_json = "enem_provas_completo.json"
    salvar_atomico(caminho_json, json.dumps(dados_finais, ensure_ascii=False, indent=2))
    print(f"\nArquivo salvo com sucesso: {caminho_json}")

    caminho_js = "enem_data.js"
    salvar_atomico(caminho_js, f"window.ENEM_DATA = {json.dumps(dados_finais, ensure_ascii=False)};")
    print(f"Arquivo JS salvo para embed sem CORS: {caminho_js}")

    return dados_finais


if __name__ == "__main__":
    coletar_todas_as_provas()
