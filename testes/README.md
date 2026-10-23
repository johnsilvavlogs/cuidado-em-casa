# Documentos para teste de leitura

Oito documentos independentes em [`receitas/`](receitas/): quatro PDFs e quatro JPEGs, com casos de ortopedia e psiquiatria. Há conteúdo digitado, manuscrito legível, trechos parcialmente ilegíveis e corpo clínico inteiramente ilegível.

Todos os pacientes e profissionais são personagens inventados para avaliação de software. As páginas têm aparência clínica e não contêm avisos de simulação. A identificação da origem sintética fica neste README e nos gabaritos externos. Os documentos não correspondem a atendimentos reais.

| Paciente | Arquivo | Cenário |
|---|---|---|
| Marina Duarte Falcão | [PDF](receitas/01_marina_duarte_falcao.pdf) | Entorse do tornozelo; digitado |
| Rafael Nogueira Lins | [PDF](receitas/02_rafael_nogueira_lins.pdf) | Dor lombar; digitado |
| Helena Costa Valença | [PDF](receitas/03_helena_costa_valenca.pdf) | Ombro; manuscrito legível |
| Bruno Almeida Tavares | [JPEG](receitas/04_bruno_almeida_tavares.jpg) | Joelho; frequência semanal ilegível |
| Camila Ribeiro Noronha | [PDF](receitas/05_camila_ribeiro_noronha.pdf) | Acompanhamento psiquiátrico; digitado |
| Lucas Martins Belmonte | [JPEG](receitas/06_lucas_martins_belmonte.jpg) | Rotina do sono; digitado |
| Beatriz Moreira Valim | [JPEG](receitas/07_beatriz_moreira_valim.jpg) | Dosagem de medicamento ilegível |
| André Carvalho Siqueira | [JPEG](receitas/08_andre_carvalho_siqueira.jpg) | Corpo clínico ilegível |

## Avaliação

Envie um arquivo de `receitas/` por teste. Não envie o gabarito junto com o documento.

- [`apoio/gabarito.json`](apoio/gabarito.json): campos esperados e comportamento diante de informações ilegíveis.
- [`apoio/manifesto.json`](apoio/manifesto.json): caminhos, tamanhos e hashes SHA-256.

Informação ausente ou ilegível deve permanecer `null`. Não adivinhar doses, datas ou frequências. Nos casos de dosagem ilegível, solicitar esclarecimento antes de criar uma posologia ativa. As categorias de legibilidade foram conferidas visualmente pelo modelo; não houve validação clínica.
