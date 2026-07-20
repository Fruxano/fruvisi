import { useState } from "react";
import { C } from "../lib/sdk";
import { createKanbanTask, type KanbanTask } from "../lib/api";
import { useT } from "../lib/i18n";
import { TASK_DRAG_MIME } from "./AgentCard";

interface TaskDockProps {
  tasks: KanbanTask[];
  onTasksChanged: () => void;
}

/** Bottom-left overlay: unassigned kanban tasks (assignable by dragging onto
 *  a card) + quick creation of new unassigned tasks. Stays visible even when
 *  everything is currently distributed. */
export function TaskDock({ tasks, onTasksChanged }: TaskDockProps) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const unassigned = tasks.filter((x) => !x.assignee && x.status !== "done" && x.status !== "archived");

  const create = async () => {
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await createKanbanTask(v, null);
      setTitle("");
      onTasksChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ao-dock">
      <button className="ao-dock-head" onClick={() => setOpen(!open)}>
        {t.unassigned(unassigned.length)} {open ? "▾" : "▸"}
      </button>
      {open ? (
        <div className="ao-dock-list">
          {unassigned.map((task) => (
            <div
              key={task.id}
              className="ao-dock-task"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TASK_DRAG_MIME, task.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              title={task.body || task.title}
            >
              <span className={"ao-status ao-status-" + task.status}>{task.status}</span>
              {task.title}
            </div>
          ))}
          <p className="ao-hint">{unassigned.length > 0 ? t.dockHint : t.dockEmpty}</p>
          <div className="ao-inline">
            <C.Input
              value={title}
              placeholder={t.dockNewTask}
              onChange={(e: any) => setTitle(e.target.value)}
              onKeyDown={(e: any) => e.key === "Enter" && create()}
            />
            <C.Button size="sm" disabled={!title.trim() || busy} onClick={create}>+</C.Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
