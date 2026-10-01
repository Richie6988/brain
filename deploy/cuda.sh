#!/usr/bin/env bash
# Recompile llama-cpp-python avec CUDA pour que les couches GPU des modèles tournent vraiment sur la carte.
# Lancé par le bouton « Compiler avec CUDA » d'Agents & modèles (administrateur), ou à la main :
#   sudo -iu nodz /home/nodz/brain/deploy/cuda.sh
# Codes de sortie : 0 compilé et vérifié, 2 pas de carte NVIDIA, 3 CUDA Toolkit (nvcc) absent,
# 4 compilé mais l'offload GPU reste inactif. Redémarrer Nodz ensuite (sudo systemctl restart nodz).
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-.venv/bin/python}"

if ! command -v nvidia-smi >/dev/null; then
    echo "Pas de carte NVIDIA sur ce serveur (nvidia-smi introuvable) : les modèles restent sur CPU."
    exit 2
fi
echo "Carte : $(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | head -1)"

NVCC="$(command -v nvcc || true)"
for candidate in /usr/local/cuda/bin/nvcc /usr/local/cuda-*/bin/nvcc; do
    [ -z "$NVCC" ] && [ -x "$candidate" ] && NVCC="$candidate"
done
if [ -z "$NVCC" ]; then
    echo "Le CUDA Toolkit (nvcc) manque. Installe-le puis relance :"
    echo "  sudo apt install -y nvidia-cuda-toolkit build-essential cmake"
    exit 3
fi
export PATH="$(dirname "$NVCC"):$PATH" CUDACXX="$NVCC"
echo "nvcc : $("$NVCC" --version | tail -1)"

# Mémoire limitée : peu de compilations en parallèle (voir DEPLOY.md pour ajouter du swap).
JOBS="${CMAKE_BUILD_PARALLEL_LEVEL:-$(( $(nproc) > 4 ? 4 : $(nproc) ))}"
echo "Compilation de llama-cpp-python avec CUDA ($JOBS tâches en parallèle), 5 à 30 minutes…"
CMAKE_ARGS="-DGGML_CUDA=on" CMAKE_BUILD_PARALLEL_LEVEL="$JOBS" FORCE_CMAKE=1 \
    "$PY" -m pip install --force-reinstall --no-cache-dir --upgrade llama-cpp-python

if "$PY" -c "import llama_cpp, sys; sys.exit(0 if llama_cpp.llama_supports_gpu_offload() else 1)"; then
    echo "Terminé : offload GPU actif. Redémarre Nodz pour l'utiliser."
else
    echo "Compilé, mais l'offload GPU reste inactif : vérifie le pilote NVIDIA et la version de CUDA."
    exit 4
fi
