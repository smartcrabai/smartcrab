# SmartCrab

- OpenClaw was AI -> tool, but this is a Rust framework that makes tool -> AI easy
- Has a Rails-like code generator

## Framework Directory Structure

- src/
  - dto/ # Types used for data passing between each Layer
  - dag/ # A series of processes modeled as a graph
  - layer/ # Layer: each represents a simple process
    - hidden/ # Layer that receives a Dto and returns Result<Dto>
    - input/ # Layer that returns Result<Dto> without receiving a Dto
      - chat/ # Layer that receives DMs/mentions from Discord etc. and returns Result<Dto>
      - cron/ # Layer that fires on a cron schedule and returns Result<Dto>
      - http/ # Layer that receives HTTP requests and returns Result<Dto>
    - output/ # Layer that receives a Dto and returns a Result

hidden and output layers can run Claude Code as a child process
