import type { ToolDefinition } from "gui-chat-protocol";
import { SCHEDULER_ACTIONS } from "./actions";

export const TOOL_NAME = "manageCalendar";

const CALENDAR_ACTIONS = [SCHEDULER_ACTIONS.show, SCHEDULER_ACTIONS.add, SCHEDULER_ACTIONS.update, SCHEDULER_ACTIONS.delete] as const;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  prompt:
    "When users mention calendar events, appointments, meetings, or one-off reminders that have a date/time, use manageCalendar. " +
    "Use show to display the calendar, add to create an event, update to edit one, delete to remove one. " +
    "Multi-day events (trips, conferences, vacations) set both `date` (start, inclusive) and `endDate` (end, inclusive) in `props`, both as `YYYY-MM-DD`. " +
    "For recurring automated tasks driven by a schedule (e.g. 'every morning at 8 fetch news'), use manageAutomations instead.",
  description:
    "Manage the user's calendar — show / add / update / delete dated calendar items. Calendar items have a title and free-form properties (date, time, location, …); multi-day events also set endDate.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...CALENDAR_ACTIONS],
        description: "show / add / delete / update.",
      },
      title: {
        type: "string",
        description: "For 'add': the item title. For 'update': new title (optional).",
      },
      id: {
        type: "string",
        description: "For 'delete' and 'update': the calendar item id.",
      },
      props: {
        type: "object",
        description:
          "For 'add': initial properties (e.g. { date, time, location, endDate }). " +
          "`date` and `endDate` are ISO `YYYY-MM-DD`; `endDate` is the inclusive last day of a multi-day event (omit for single-day events). " +
          "For 'update': properties to merge in; set a key to null to remove it.",
        additionalProperties: true,
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
