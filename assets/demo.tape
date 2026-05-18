# craboodle demo — running the haiku-writer eval pipeline
#
# Renders to assets/demo.gif. Re-record with:
#   ANTHROPIC_API_KEY=... vhs assets/demo.tape
#
# Note: this runs craboodle against the live Anthropic API via scuttlerun
# and pincenez; output will differ between recordings due to LLM
# non-determinism.

Output assets/demo.gif

Set WindowBar Colorful
Set Shell "zsh"
Set FontSize 20
Set FontFamily "Iosevka Term"
Set Width 1200
Set Height 1440
Set Theme "GruvboxDark"
Set TypingSpeed 60ms
Set PlaybackSpeed 1.0

Hide
Type `alias cat='bat --theme gruvbox-dark'`
Enter
Type `alias highlight='bat --theme gruvbox-dark --paging=never --language yaml'`
Enter
Ctrl+L
Show

Sleep 1s
# Show the scenario so viewers know what's being asked of the model.
Type "cat examples/haiku-writer/topic-provided/scenario.yaml"
Sleep 1s
Enter 3
Sleep 6s

# Show the checks so viewers know what's being graded.
Type "cat examples/haiku-writer/topic-provided/checks.yaml"
Sleep 1s
Enter 3
Sleep 10s

# Run the eval pipeline for a single scenario, one repetition.
Type "craboodle run ./examples/haiku-writer --scenarios topic-provided --repeats 1 --concurrency 1 | highlight"
Sleep 2s
Enter
Wait@120s
Sleep 15s
