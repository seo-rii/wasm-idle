/* Unit fixture for the exact producer patch's idle-boundary guard.
   This does not qualify Readline, Bash execution, or the browser runtime. */
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { int attributes; } SHELL_VAR;
#define att_readonly 1
#define att_imported 2
#define att_exported 4
#define readonly_p(v) ((v)->attributes & att_readonly)
#define imported_p(v) ((v)->attributes & att_imported)
#define FREE(v) free(v)
#define RL_STATE_READCMD 0x8
#define RL_STATE_METANEXT 0x10
#define RL_STATE_DISPATCHING 0x20
#define RL_STATE_MOREINPUT 0x40
#define RL_STATE_ISEARCH 0x80
#define RL_STATE_NSEARCH 0x100
#define RL_STATE_SEARCH 0x200
#define RL_STATE_NUMERICARG 0x400
#define RL_STATE_MACROINPUT 0x800
#define RL_STATE_MACRODEF 0x1000
#define RL_STATE_COMPLETING 0x4000
#define RL_STATE_SIGHANDLER 0x8000
#define RL_STATE_UNDOING 0x10000
#define RL_STATE_INPUTPENDING 0x20000
#define RL_STATE_VIMOTION 0x100000
#define RL_STATE_MULTIKEY 0x200000
#define RL_STATE_CHARSEARCH 0x800000
#define RL_STATE_REDISPLAYING 0x1000000
#define RL_STATE_DONE 0x2000000
#define RL_ISSTATE(v) (rl_readline_state & (v))

static int executing, interactive_shell = 1, prompt_level = 1, rl_done;
static int rl_readline_state = RL_STATE_READCMD;
static int last_command_exit_signal = 9, calls, function_present = 1;
static SHELL_VAR function_value = { 1 };
static char *lastarg_value = "previous argument";
static char restored_lastarg[128];
static int wasm_idle_readline_poll(void);
static int (*rl_event_hook)(void);
static int array_needs_making;
static int resizes, size_resets, forced_redraws, prompt_redraws, display_step;
static int cap_lookups, tail_erases, output_chars, has_tail_capability = 1;
char *tgetstr(char *cap, char **area) {
  assert(strcmp(cap, "cd") == 0 && area == NULL);
  cap_lookups++;
  return has_tail_capability ? strdup("erase-tail") : NULL;
}
int putx(int c) {
  assert(c == "erase-tail"[output_chars++]);
  return c;
}
int tputs(const char *cap, int lines, int (*output)(int)) {
  assert(display_step == 2 && lines == 1 && output == putx);
  assert(strcmp(cap, "erase-tail") == 0);
  tail_erases++;
  while (*cap) output(*cap++);
  return 0;
}
int rl_clear_visible_line(void) { assert(display_step == 0); display_step = 1; return 0; }
int rl_on_new_line(void) { assert(display_step == 1); display_step = 2; return 0; }
void rl_resize_terminal(void) { assert(display_step == 2); resizes++; display_step = 0; }
void rl_reset_screen_size(void) { size_resets++; }
static void rl_forced_update_display(void) { forced_redraws++; }
static void rl_redraw_prompt_last_line(void) { prompt_redraws++; }
static void redisplay(int poll, int r, char *ce) {
/* REDISPLAY_SOURCE */
}
static char *control_environment;
static char *control_getenv(const char *name) {
  assert(strcmp(name, "WASM_IDLE_SHELL_CONTROL") == 0);
  return control_environment;
}
#define getenv control_getenv
static int get_current_prompt_level(void) { return prompt_level; }
static SHELL_VAR *find_function(const char *name) {
  assert(strcmp(name, "__wasm_idle_poll") == 0);
  return function_present ? &function_value : NULL;
}
static char *get_string_value(const char *name) {
  assert(strcmp(name, "_") == 0);
  return lastarg_value;
}
static char *savestring(const char *s) { return strdup(s); }
static SHELL_VAR *bind_variable(const char *name, char *value, int flags) {
  assert(strcmp(name, "_") == 0 && flags == 0);
  if (value) {
    snprintf(restored_lastarg, sizeof restored_lastarg, "%s", value);
    lastarg_value = restored_lastarg;
  } else lastarg_value = NULL;
  return NULL;
}
static int bash_execute_readline_command(char *command, int poll) {
  assert(strcmp(command, "__wasm_idle_poll") == 0 && poll == 1);
  calls++;
  assert(wasm_idle_readline_poll() == 0); /* Active guard prevents reentry. */
  last_command_exit_signal = 99;
  lastarg_value = "hook argument";
  return 124;
}

/* POLL_SOURCE */

static void initialize_control(void) {
/* INIT_SOURCE */
}

int main(void) {
  redisplay(1, 0, 0);
  assert(resizes == 0 && forced_redraws == 0 && prompt_redraws == 0);
  redisplay(1, 125, 0);
  assert(resizes == 1 && forced_redraws == 0 && prompt_redraws == 0);
  assert(cap_lookups == 1 && tail_erases == 1 && output_chars == 10);
  redisplay(1, 126, 0);
  assert(size_resets == 1 && resizes == 1 && forced_redraws == 0 && prompt_redraws == 0);
  redisplay(1, 124, 0);
  assert(resizes == 1 && forced_redraws == 1 && prompt_redraws == 0);
  redisplay(0, 125, "ce"); /* bind -x does not gain a new control status. */
  assert(resizes == 1 && forced_redraws == 1 && prompt_redraws == 1);
  redisplay(0, 124, "ce");
  assert(resizes == 1 && forced_redraws == 2 && prompt_redraws == 1);
  redisplay(0, 126, "ce");
  assert(size_resets == 1 && prompt_redraws == 2);
  assert(cap_lookups == 1 && tail_erases == 1);
  has_tail_capability = 0;
  redisplay(1, 125, NULL);
  assert(resizes == 2 && cap_lookups == 2 && tail_erases == 1);

  /* Only normal Bash-imported host control is made readonly and nonexported.
     An absent or invalid opt-in leaves all existing function state untouched. */
  function_value.attributes = att_imported | att_exported;
  initialize_control();
  assert(rl_event_hook == NULL);
  assert(array_needs_making == 0);
  assert(function_value.attributes == (att_imported | att_exported));
  control_environment = "0";
  initialize_control();
  assert(rl_event_hook == NULL);
  assert(function_value.attributes == (att_imported | att_exported));
  control_environment = "1";
  initialize_control();
  assert(rl_event_hook == wasm_idle_readline_poll);
  assert(function_value.attributes == (att_imported | att_readonly));
  assert(array_needs_making == 1);
  array_needs_making = 0;
  function_value.attributes = att_imported | att_exported;
  initialize_control();
  assert(rl_event_hook == wasm_idle_readline_poll);
  assert(function_value.attributes == (att_imported | att_exported));
  assert(array_needs_making == 0);
  rl_event_hook = NULL;
  function_value.attributes = att_exported;
  initialize_control();
  assert(function_value.attributes == att_exported);
  rl_event_hook = NULL;
  function_value.attributes = att_readonly | att_exported;
  initialize_control();
  assert(function_value.attributes == (att_readonly | att_exported));
  rl_event_hook = NULL;
  function_present = 0;
  initialize_control();
  assert(rl_event_hook == wasm_idle_readline_poll);
  function_present = 1;
  function_value.attributes = att_readonly;

  const int blocked[] = { RL_STATE_METANEXT, RL_STATE_DISPATCHING,
    RL_STATE_MOREINPUT, RL_STATE_ISEARCH, RL_STATE_NSEARCH, RL_STATE_SEARCH,
    RL_STATE_NUMERICARG, RL_STATE_MACROINPUT, RL_STATE_MACRODEF,
    RL_STATE_COMPLETING, RL_STATE_SIGHANDLER, RL_STATE_UNDOING,
    RL_STATE_INPUTPENDING, RL_STATE_VIMOTION, RL_STATE_MULTIKEY,
    RL_STATE_CHARSEARCH, RL_STATE_REDISPLAYING, RL_STATE_DONE };
  executing = 1; wasm_idle_readline_poll(); assert(calls == 0); executing = 0;
  interactive_shell = 0; wasm_idle_readline_poll(); assert(calls == 0); interactive_shell = 1;
  prompt_level = 2; wasm_idle_readline_poll(); assert(calls == 0); prompt_level = 1;
  rl_done = 1; wasm_idle_readline_poll(); assert(calls == 0); rl_done = 0;
  rl_readline_state = 0; wasm_idle_readline_poll(); assert(calls == 0);
  for (size_t i = 0; i < sizeof blocked / sizeof blocked[0]; i++) {
    rl_readline_state = RL_STATE_READCMD | blocked[i];
    wasm_idle_readline_poll(); assert(calls == 0);
  }
  rl_readline_state = RL_STATE_READCMD;
  function_present = 0; wasm_idle_readline_poll(); assert(calls == 0); function_present = 1;
  function_value.attributes = 0; wasm_idle_readline_poll(); assert(calls == 0); function_value.attributes = 1;
  wasm_idle_readline_poll(); assert(calls == 1);
  assert(last_command_exit_signal == 9);
  assert(strcmp(lastarg_value, "previous argument") == 0);
  wasm_idle_readline_poll(); assert(calls == 2);
  assert(strcmp(lastarg_value, "previous argument") == 0);
  lastarg_value = NULL;
  wasm_idle_readline_poll(); assert(calls == 3 && lastarg_value == NULL);
  return 0;
}
