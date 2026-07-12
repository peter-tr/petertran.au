# Resume PDF

`peter-tran-resume.pdf` is generated from `resume.tex` - edit the `.tex` and
recompile, don't edit the PDF directly. The filename is linked directly from
`Resume.tsx`, `Nav.tsx`, and `Hero.tsx`, so keep it exact.

## Regenerating the PDF

1. Get a LaTeX engine on your `PATH` (skip if you already have one):
   - **pdflatex** (full TeX distribution) - macOS:
     `brew install --cask mactex-no-gui`, or the smaller
     `brew install --cask basictex`; Linux: `apt install texlive-latex-extra`.
   - **[tectonic](https://tectonic-typesetting.github.io/)** (self-contained
     single binary, no package manager needed) - macOS: `brew install tectonic`.
     If Homebrew isn't available, download a prebuilt binary directly from the
     [releases page](https://github.com/tectonic-typesetting/tectonic/releases)
     (e.g. `tectonic-<version>-aarch64-apple-darwin.tar.gz` for Apple Silicon,
     `x86_64-apple-darwin` for Intel), `tar xzf` it, and put the extracted
     `tectonic` binary on your `PATH`.
2. Compile:
   ```
   pdflatex resume.tex   # or: tectonic resume.tex
   ```
3. Copy/rename the output (`resume.pdf`) over `peter-tran-resume.pdf`.

Note: `resume.tex` guards the pdfTeX-only `\pdfgentounicode` primitive with
`\ifdefined`, so it compiles cleanly under both pdflatex and tectonic's
XeTeX-based engine.
