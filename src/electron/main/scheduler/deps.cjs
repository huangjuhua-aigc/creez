/**
 * Scheduler deps set by main index after DB/repos are ready.
 * Builtin skill handler (create_scheduled_task) uses getSchedulerDeps() to access taskRepository and cronManager.
 */

let schedulerDeps = null;

function setSchedulerDeps(d) {
  schedulerDeps = d;
}

function getSchedulerDeps() {
  return schedulerDeps;
}

module.exports = {
  setSchedulerDeps,
  getSchedulerDeps,
};
