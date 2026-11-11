from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import time
import urllib.request


def validar_imagem(conteudo):
    if not conteudo or len(conteudo) < 100:
        return False
    return conteudo.startswith((b"GIF8", b"\x89PNG", b"\xff\xd8\xff"))


def baixar_uma_imagem(url, caminho_local, tentativas=2):
    for tentativa in range(1, tentativas + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            conteudo = urllib.request.urlopen(req, timeout=12).read()
            if not validar_imagem(conteudo):
                raise ValueError("Conteudo invalido (nao e imagem)")
            tmp = f"{caminho_local}.tmp"
            with open(tmp, "wb") as f_out:
                f_out.write(conteudo)
            os.replace(tmp, caminho_local)
            return len(conteudo)
        except Exception as err:
            if tentativa == tentativas:
                raise err
            time.sleep(0.35)
    return 0


def baixar_todas_imagens():
    if not os.path.exists("enem_provas_completo.json"):
        print("Erro: execute scraper_enem.py primeiro.")
        return {"baixadas": 0, "existentes": 0, "falhas": 0}

    with open("enem_provas_completo.json", "r", encoding="utf-8") as f:
        dados = json.load(f)

    pasta_destino = "imagens_resolucoes"
    os.makedirs(pasta_destino, exist_ok=True)

    canonicos = dados.get("repositorio_canonico", {})
    pendentes = []
    existentes = 0

    for id_can, info in canonicos.items():
        url = info.get("imagem_url")
        if not url:
            continue
        arquivo_rel = info.get("arquivo_local") or os.path.join(pasta_destino, f"{id_can}.gif")
        caminho_local = arquivo_rel if os.path.dirname(arquivo_rel) else os.path.join(pasta_destino, arquivo_rel)

        if os.path.exists(caminho_local) and os.path.getsize(caminho_local) > 100:
            existentes += 1
        else:
            pendentes.append((id_can, url, caminho_local))

    total = len(canonicos)
    print(f"Total canonicas: {total} | Ja locais: {existentes} | Para baixar: {len(pendentes)}")

    if not pendentes:
        return {"baixadas": 0, "existentes": existentes, "falhas": 0}

    baixadas = 0
    falhas = 0

    with ThreadPoolExecutor(max_workers=6) as pool:
        futuros = {
            pool.submit(baixar_uma_imagem, url, caminho): (id_can, url)
            for id_can, url, caminho in pendentes
        }
        for i, fut in enumerate(as_completed(futuros), 1):
            id_can, url = futuros[fut]
            try:
                tamanho = fut.result()
                baixadas += 1
                if i % 10 == 0 or i == len(pendentes):
                    print(f"[{i}/{len(pendentes)}] Baixado: {id_can} ({tamanho // 1024} KB)")
            except Exception as e:
                falhas += 1
                print(f"Falha ao baixar {url}: {e}")

    print(f"\nFinalizado! Novas: {baixadas} | Ja existentes: {existentes} | Falhas: {falhas}")
    return {"baixadas": baixadas, "existentes": existentes, "falhas": falhas}


if __name__ == "__main__":
    baixar_todas_imagens()
