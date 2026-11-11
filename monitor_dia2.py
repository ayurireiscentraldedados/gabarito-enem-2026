import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

from download_images import baixar_todas_imagens
from scraper_enem import BASE_URL, CORES_DIA2, coletar_todas_as_provas, parsear_html_prova

BRT = timezone(timedelta(hours=-3))
DEFAULT_NETLIFY_SITE_ID = "46f8d61c-61d8-480f-a31f-bbef8be60ab6"

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass


def carregar_variaveis_env_locais():
    """Carrega .env local ou ~/.env sem sobrescrever variaveis ja exportadas no ambiente."""
    caminhos = [
        os.path.join(os.getcwd(), ".env"),
        os.path.expanduser("~/.env"),
    ]
    for caminho in caminhos:
        if not os.path.exists(caminho):
            continue
        try:
            with open(caminho, "r", encoding="utf-8") as f:
                for linha in f:
                    linha = linha.strip()
                    if not linha or linha.startswith("#") or "=" not in linha:
                        continue
                    chave, valor = linha.split("=", 1)
                    chave = chave.strip()
                    valor = valor.strip().strip('"').strip("'")
                    if chave and chave not in os.environ and valor:
                        os.environ[chave] = valor
        except Exception:
            pass


carregar_variaveis_env_locais()


def obter_config_netlify():
    site_id = os.environ.get("NETLIFY_SITE_ID", "").strip() or DEFAULT_NETLIFY_SITE_ID
    auth_token = os.environ.get("NETLIFY_AUTH_TOKEN", "").strip()
    return site_id, auth_token


def agora_brt():
    return datetime.now(BRT)


def agora_str():
    return agora_brt().strftime("%H:%M:%S")


def assinatura_local_dia2(caminho_json="enem_provas_completo.json"):
    if not os.path.exists(caminho_json):
        return None, {c: 0 for c in CORES_DIA2}

    try:
        with open(caminho_json, "r", encoding="utf-8") as f:
            dados = json.load(f)
    except Exception:
        return None, {c: 0 for c in CORES_DIA2}

    registros = []
    contagens = {}
    for cor in CORES_DIA2:
        qs = dados.get("provas", {}).get(cor, {}).get("questoes", [])
        pubs = [q for q in qs if q.get("dia") == 2 and q.get("publicada")]
        contagens[cor] = len(pubs)
        for q in pubs:
            registros.append((cor, str(q.get("numero", "")), str(q.get("gabarito") or ""), str(q.get("imagem_rel") or "")))

    registros.sort()
    sig = hashlib.sha256(json.dumps(registros, ensure_ascii=False).encode("utf-8")).hexdigest()
    return sig, contagens


def assinatura_remota_dia2():
    registros = []
    contagens = {}
    erros = 0

    for cor in CORES_DIA2:
        url = f"{BASE_URL}?prova={cor}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept-Language": "pt-BR,pt;q=0.9",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                status = getattr(resp, "status", 200)
                html = resp.read().decode("utf-8", errors="ignore")
            if status != 200 or not html:
                raise RuntimeError(f"HTTP {status} (resposta vazia)")
            parsed = parsear_html_prova(html, cor)
            if not parsed and cor != "cinza":
                raise RuntimeError("HTML recebido sem secao #questoes (possivel bloqueio/manutencao)")
            pubs = [q for q in parsed if q.get("dia") == 2 and q.get("publicada")]
            contagens[cor] = len(pubs)
            for q in pubs:
                registros.append((cor, str(q.get("numero", "")), str(q.get("gabarito") or ""), str(q.get("imagem_rel") or "")))
        except urllib.error.HTTPError as e:
            erros += 1
            contagens[cor] = -1
            print(f"[{agora_str()}] Aviso HTTP ao consultar {cor}: {e.code} {e.reason}")
        except Exception as e:
            erros += 1
            contagens[cor] = -1
            print(f"[{agora_str()}] Aviso ao consultar {cor}: {e}")

    if erros == len(CORES_DIA2):
        return None, contagens, True

    registros.sort()
    sig = hashlib.sha256(json.dumps(registros, ensure_ascii=False).encode("utf-8")).hexdigest()
    return sig, contagens, erros > 0


def atualizar_cache_buster_html(caminho_html="index.html"):
    if not os.path.exists(caminho_html):
        return
    versao = agora_brt().strftime("2026%m%d_%H%M%S")
    with open(caminho_html, "r", encoding="utf-8") as f:
        conteudo = f.read()

    novo_conteudo, n = re.subn(
        r"enem_data\.js\?v=[A-Za-z0-9_.-]+",
        f"enem_data.js?v=live_{versao}",
        conteudo,
    )
    if n > 0 and novo_conteudo != conteudo:
        tmp = f"{caminho_html}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(novo_conteudo)
        os.replace(tmp, caminho_html)
        print(f"[{agora_str()}] Cache-buster atualizado em {caminho_html}: live_{versao}")


def publicar_netlify():
    site_id, auth_token = obter_config_netlify()
    if not site_id or not auth_token:
        print(f"[{agora_str()}] Deploy ignorado: NETLIFY_AUTH_TOKEN ausente no ambiente ou em .env.")
        return False

    netlify_bin = shutil.which("netlify")
    if netlify_bin:
        cmd = [netlify_bin, "deploy", "--prod", "--dir", ".", "--site", site_id, "--auth", auth_token]
    else:
        npx_bin = shutil.which("npx")
        if not npx_bin:
            print(f"[{agora_str()}] [ERRO DEPLOY] Nem 'netlify' nem 'npx' encontrados no PATH.")
            return False
        cmd = [npx_bin, "--yes", "netlify-cli", "deploy", "--prod", "--dir", ".", "--site", site_id, "--auth", auth_token]

    print(f"[{agora_str()}] Iniciando deploy automatico no Netlify...")
    try:
        res = subprocess.run(cmd, check=False)
        if res.returncode == 0:
            print(f"[{agora_str()}] [DEPLOY OK] Producao atualizada em https://moonlit-quokka-a186ac.netlify.app")
            return True
        print(f"[{agora_str()}] [ERRO DEPLOY] Falha ao publicar no Netlify (codigo {res.returncode}).")
    except Exception as e:
        print(f"[{agora_str()}] [ERRO DEPLOY] Excecao ao acionar CLI Netlify: {type(e).__name__}")
    return False


def sincronizar_git():
    """Salva arquivos atualizados de volta no repositorio Git (usado no GitHub Actions)."""
    git_bin = shutil.which("git")
    if not git_bin or not os.path.exists(".git"):
        return False

    caminhos = ["index.html", "enem_data.js", "enem_provas_completo.json", "imagens_resolucoes"]
    existentes = [p for p in caminhos if os.path.exists(p)]
    if not existentes:
        return False

    try:
        subprocess.run([git_bin, "add", *existentes], check=True)
        diff_res = subprocess.run([git_bin, "diff", "--cached", "--quiet"], check=False)
        if diff_res.returncode == 0:
            print(f"[{agora_str()}] [GIT] Nenhuma alteracao pendente para commit.")
            return True

        msg = f"chore: atualiza gabarito ENEM 2o Dia ({agora_brt().strftime('%d/%m %H:%M BRT')}) [skip ci]"
        subprocess.run([git_bin, "commit", "-m", msg], check=True)
        subprocess.run([git_bin, "pull", "--rebase", "--autostash"], check=False)
        push_res = subprocess.run([git_bin, "push"], check=False)
        if push_res.returncode == 0:
            print(f"[{agora_str()}] [GIT OK] Estado atualizado salvo no repositorio.")
            return True
        print(f"[{agora_str()}] [GIT AVISO] Falha no git push (codigo {push_res.returncode}).")
    except Exception as e:
        print(f"[{agora_str()}] [GIT AVISO] Erro ao sincronizar Git: {e}")
    return False


def executar_ciclo(fazer_deploy=True, git_sync=False):
    sig_remota, cont_remota, houve_erro_parcial = assinatura_remota_dia2()
    if sig_remota is None:
        print(f"[{agora_str()}] Falha total de rede ao consultar Farias Brito. Tentando novamente no proximo ciclo.")
        return False, cont_remota, False

    sig_local, cont_local = assinatura_local_dia2()

    nomes_curto = {"azul": "Azul", "rosa": "Verde", "amarela": "Amarela", "cinza": "Cinza"}
    resumo = " | ".join(
        f"{nomes_curto.get(c, c)}: {cont_remota[c] if cont_remota[c] >= 0 else '?'}/90"
        for c in CORES_DIA2
    )

    if sig_remota == sig_local:
        print(f"[{agora_str()}] Conexao OK com Farias Brito. Sem novidades no 2o Dia ({resumo}).")
        return False, cont_remota, True

    if houve_erro_parcial and sum(max(0, v) for v in cont_remota.values()) < sum(cont_local.values()):
        print(f"[{agora_str()}] Erro parcial de rede detectado ({resumo}). Aguardando proximo ciclo sem sobrescrever.")
        return False, cont_remota, False

    print(f"[{agora_str()}] [NOVIDADE DETECTADA] 2o Dia atualizado! ({resumo})")
    coletar_todas_as_provas()
    baixar_todas_imagens()
    atualizar_cache_buster_html()

    deploy_ok = True
    if fazer_deploy:
        deploy_ok = publicar_netlify()

    if git_sync:
        sincronizar_git()

    return deploy_ok, cont_remota, True


def passou_horario_limite_brt(until_brt, data_inicio=None):
    if not until_brt:
        return False
    try:
        hora_s, min_s = until_brt.strip().split(":", 1)
        hora, minuto = int(hora_s), int(min_s)
        agora = agora_brt()
        if data_inicio and agora.date() > data_inicio:
            return True
        return (agora.hour, agora.minute) >= (hora, minuto)
    except Exception:
        return False


def monitorar_em_loop(intervalo_segundos=60, fazer_deploy=True, max_minutes=0, until_brt="", git_sync=False):
    inicio = time.monotonic()
    data_inicio = agora_brt().date()
    print(
        f"[{agora_str()}] Monitor ENEM 2o Dia iniciado "
        f"(intervalo={intervalo_segundos}s | auto-deploy={'SIM' if fazer_deploy else 'NAO'} "
        f"| git-sync={'SIM' if git_sync else 'NAO'}"
        + (f" | max={max_minutes}m" if max_minutes > 0 else "")
        + (f" | ate={until_brt} BRT" if until_brt else "")
        + ")..."
    )
    while True:
        try:
            _, contagens, _ = executar_ciclo(fazer_deploy=fazer_deploy, git_sync=git_sync)
            todas_completas = all(contagens.get(c, 0) >= 90 for c in CORES_DIA2)

            decorrido_min = (time.monotonic() - inicio) / 60.0
            if max_minutes > 0 and decorrido_min >= max_minutes:
                print(f"[{agora_str()}] Tempo maximo atingido ({max_minutes} min). Encerrando com seguranca.")
                break
            if passou_horario_limite_brt(until_brt, data_inicio=data_inicio):
                print(f"[{agora_str()}] Horario limite ({until_brt} BRT) atingido. Encerrando com seguranca.")
                break

            espera = 300 if todas_completas else intervalo_segundos
            if todas_completas:
                print(f"[{agora_str()}] Todos os 4 cadernos atingiram 90/90! Checando erratas a cada 5 min...")
            time.sleep(espera)
        except KeyboardInterrupt:
            print(f"\n[{agora_str()}] Monitoramento encerrado pelo usuario.")
            break
        except Exception as e:
            print(f"[{agora_str()}] Erro inesperado no loop: {e}")
            time.sleep(intervalo_segundos)


def main():
    parser = argparse.ArgumentParser(description="Monitor ao vivo ENEM 2026 - 2o Dia (O POVO+ & Farias Brito)")
    parser.add_argument("--interval", type=int, default=60, help="Intervalo em segundos entre verificacoes (padrao: 60)")
    parser.add_argument("--once", action="store_true", help="Executa apenas 1 verificacao e encerra")
    parser.add_argument("--no-deploy", action="store_true", help="Gera os dados/imagens locais sem rodar deploy no Netlify")
    parser.add_argument("--git-sync", action="store_true", help="Faz commit e push de atualizacoes detectadas para o Git")
    parser.add_argument("--max-minutes", type=float, default=0, help="Encerra o loop apos N minutos (util em CI/GitHub Actions)")
    parser.add_argument("--until-brt", type=str, default="", help="Encerra o loop ao atingir HH:MM no horario de Brasilia (BRT)")
    args = parser.parse_args()

    if args.once:
        _, _, conectou = executar_ciclo(fazer_deploy=not args.no_deploy, git_sync=args.git_sync)
        if not conectou:
            sys.exit(2)
    else:
        monitorar_em_loop(
            intervalo_segundos=args.interval,
            fazer_deploy=not args.no_deploy,
            max_minutes=args.max_minutes,
            until_brt=args.until_brt,
            git_sync=args.git_sync,
        )


if __name__ == "__main__":
    main()
