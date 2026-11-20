# Isolate memory benchmark modes by workspace

`--memory` enables both Memory Entry kinds by default and `--memory-kinds function|method|function,method` restricts them, giving the Functions, Methods and Hybrid modes; Baseline passes no memory option. Each mode runs in its own workspace (a copy or worktree of the test repository) so it starts with an empty learned memory and shares nothing with the others.

The memory directory stays fixed at `<workspace>/.tours/.memory` and the existing refusal of any other path is kept. Allowing a `--memory-dir` override would be simpler for the benchmark script, but it would weaken the rule that a workspace has exactly one memory location; preparing and cleaning one workspace per mode is the accepted cost.
