#!/usr/bin/env bash
# Compile stable-diffusion.cpp (binaire « sd ») pour générer les images FLUX / SD du Gardien, avec CUDA si le CUDA
# Toolkit est là, sinon pour le CPU. Lancé par le bouton « Installer stable-diffusion.cpp » d'Agents & modèles
# (administrateur), ou à la main :
#   sudo -iu nodz /home/nodz/brain/deploy/sd.sh
# Le binaire est relié en var/sd/bin/sd, où Nodz le trouve sans redémarrage.
# Codes de sortie : 0 installé et vérifié, 3 outils de compilation absents, 5 la compilation a échoué.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD/var/sd"
SRC="$ROOT/src"
mkdir -p "$ROOT/bin"

missing=""
for tool in git cmake g++ make; do
    command -v "$tool" >/dev/null || missing="$missing $tool"
done
if [ -n "$missing" ]; then
    echo "Outils de compilation absents :$missing. Installe-les puis relance :"
    echo "  sudo apt install -y git cmake build-essential"
    exit 3
fi

if [ -d "$SRC/.git" ]; then
    echo "Mise à jour des sources de stable-diffusion.cpp…"
    git -C "$SRC" pull --ff-only
    git -C "$SRC" submodule update --init --recursive
else
    echo "Téléchargement des sources de stable-diffusion.cpp…"
    git clone --depth 1 --recursive https://github.com/leejet/stable-diffusion.cpp "$SRC"
fi

FLAGS=(-DCMAKE_BUILD_TYPE=Release)
NVCC="$(command -v nvcc || true)"
for candidate in /usr/local/cuda/bin/nvcc /usr/local/cuda-*/bin/nvcc; do
    [ -z "$NVCC" ] && [ -x "$candidate" ] && NVCC="$candidate"
done
if [ -n "$NVCC" ] && command -v nvidia-smi >/dev/null; then
    export PATH="$(dirname "$NVCC"):$PATH" CUDACXX="$NVCC"
    FLAGS+=(-DSD_CUDA=ON)
    echo "Avec CUDA : $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1), $("$NVCC" --version | tail -1)"
else
    echo "Sans CUDA (pas de carte NVIDIA ou pas de nvcc) : les images seront calculées sur CPU, bien plus lentement."
fi

# Mémoire limitée : peu de compilations en parallèle (voir DEPLOY.md pour ajouter du swap).
JOBS="${CMAKE_BUILD_PARALLEL_LEVEL:-$(( $(nproc) > 4 ? 4 : $(nproc) ))}"
echo "Compilation ($JOBS tâches en parallèle), 5 à 30 minutes…"
if ! cmake -S "$SRC" -B "$SRC/build" "${FLAGS[@]}" || ! cmake --build "$SRC/build" --config Release -j "$JOBS"; then
    echo "La compilation a échoué : voir les lignes ci-dessus."
    exit 5
fi

BUILT=""
for name in sd sd-cli; do
    [ -z "$BUILT" ] && [ -x "$SRC/build/bin/$name" ] && BUILT="$SRC/build/bin/$name"
done
if [ -z "$BUILT" ] || ! "$BUILT" --help 2>&1 | grep -qi diffusion; then
    echo "Compilé, mais le binaire sd est introuvable ou ne répond pas."
    exit 5
fi
ln -sf "$BUILT" "$ROOT/bin/sd"  # lien : le binaire garde ses bibliothèques à côté de lui
echo "Terminé : $ROOT/bin/sd. Installe un modèle d'image (pack FLUX) et le Gardien peut générer des images."
