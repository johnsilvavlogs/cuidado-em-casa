# Cuidado em Casa · website

Site publicado: https://cuidado-em-casa.johnsilvabr.chatgpt.site

Site estático em português. Execute na raiz do repositório:

```sh
node website/serve.mjs
```

Abra http://127.0.0.1:4175. O servidor publica somente HTML, CSS, JavaScript e os arquivos de `assets/`; não expõe o repositório ou arquivos de ambiente.

Para conectar a versão publicada ao aplicativo, preencha **somente `appUrl` em `website/config.js`** com a URL HTTPS pública verificada. Em localhost, o CTA abre `http://127.0.0.1:3000/`. Sem uma URL pública configurada, outros hosts mostram um aviso com acesso à prévia desta página. URLs inválidas não viram destinos de navegação.

A prévia usa estado em memória compartilhado entre Helena e Marina. Propor não salva; cancelar preserva o estado; confirmar atualiza ambas as perspectivas; reiniciar restaura. Os dados somem ao recarregar. Nenhum microfone, API, conta ou armazenamento do aplicativo é acessado.

## Imagens e tipografia

- `hero-room.png`: cenário gerado a partir da direção visual vencedora; não representa usuários ou um local real.
- `patient.png`, `source.png`, `plan.png`, `voice.png`, `caregiver-history.jpg`: capturas reais do protótipo com dados fictícios. O documento não deve orientar cuidados reais.
- Work Sans (300, 400, 500, 600): Google Fonts, servido localmente. Licença SIL Open Font License: https://github.com/weiweihuanghuang/Work-Sans/blob/master/OFL.txt.

Os nomes de tecnologias descrevem seu papel no protótipo, sem alegação de validação clínica, endosso ou lançamento público. O app não é alterado por este site.

## Controles de vidro

O seletor de perspectivas e a borda do CTA usam um acabamento translúcido inspirado nos materiais de interface da Apple; não são componentes nativos ou código da Apple. Em telas de até 600 px, o seletor alterna um único celular, com dois segmentos de largura igual, rótulos escuros, foco visível e uma lente ativa que desliza. Acima de 600 px, as duas perspectivas aparecem lado a lado e o seletor é removido da tela e da navegação por teclado. `prefers-reduced-motion` remove o movimento; redução de transparência, contraste aumentado ou ausência de `backdrop-filter` produzem uma alternativa opaca.

Referências: [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) e [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls).
