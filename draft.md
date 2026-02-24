# SmartCrab

- OpenClawはAI→ツールだったが、ツール→AIを簡単にできるようにするRustフレームワーク
- Railsライクなコードジェネレータを持つ

## フレームワーのディレクトリ構成

- src/
　- dto/ # 各Layer間のデータ受け渡しに使う型
　- dag/ # 一連処理をグラフ化したもの
  - layer/ # Layer: 1つ1つはシンプルな処理を表す
    - hidden/ # Dtoを受け取ってResult<Dto>を返すlayer
    - input/ # Dtoを受け取らずにResult<Dto>を返すlayer
      - chat/ # Discord等からDM/メンションを受け取ってResult<Dto>を返すlayer
      - cron/ # Cronで発火してResult<Dto>を返すlayer
      - http/ # HTTPリクエストを受けてResult<Dto>を返すlayer
    - output/ # dtoを受け取ってResultを返すlayer

hiddenやoutputではClaude Codeを子プロセスとして実行できる
