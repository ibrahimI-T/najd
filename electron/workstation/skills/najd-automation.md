---
name: najd-automation
description: Create, run, pause and inspect scheduled tasks in Task Center. Use when the user asks for something to happen on a schedule or to repeat.
---

# Automation

Load the workstation toolset. Use najd_workstation with action "tasks_list" before creating, so a duplicate is not made.

Agree the schedule in plain words first, then convert it: cron plus an IANA time zone for calendar times, minutes for a fixed interval. Write the prompt so it stands alone, because the task runs without this conversation.

Create with action "task_create"; the user approves it in chat. A scheduled run cannot ask for approval, so a task whose work needs one stops with NEEDS_APPROVAL. Tell the user that when the task will change files or act in apps.

Report the next run time from the result. Use "task_run" to test once, and read the result with "tasks_list".
