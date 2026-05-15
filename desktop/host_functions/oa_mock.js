// Mock implementations of the OA tools defined in tools/oa_tools.json.
//
// Real deployment replaces these with HTTP calls to your company's OA
// system (DingTalk / Lark / Weiwei / custom). For demo, each handler
// returns a synthetic success response so the Spotlight UI shows
// "ok" + a reasonable summary.

const { Notification } = require('electron');

function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch {}
}

function id() {
  return 'OA-' + Date.now().toString(36).toUpperCase().slice(-6);
}

module.exports = {

  submit_leave_request: async ({ type, start_date, end_date, reason }) => {
    const ref = id();
    notify('请假已提交', `${type} · ${start_date}–${end_date}`);
    return { ref, status: 'pending_approval',
             summary: `${type} leave ${start_date}–${end_date}` };
  },

  submit_business_trip: async ({ destination, start_date, end_date, purpose }) => {
    const ref = id();
    notify('出差申请已提交', `${destination} · ${start_date}–${end_date}`);
    return { ref, status: 'pending', summary: `trip to ${destination}` };
  },

  submit_overtime: async ({ date, hours, reason }) => {
    const ref = id();
    notify('加班申请已提交', `${date} · ${hours}h`);
    return { ref, status: 'pending', summary: `OT ${hours}h on ${date}` };
  },

  submit_reimbursement: async ({ category, amount, occurred_on, description }) => {
    const ref = id();
    notify('报销已提交', `${category} · ¥${amount}`);
    return { ref, status: 'pending', summary: `¥${amount} ${category}` };
  },

  book_meeting_room: async ({ date, start_time, end_time, room, headcount }) => {
    const ref = id();
    notify('会议室预订', `${room || 'auto-pick'} · ${date} ${start_time}-${end_time}`);
    return { ref, status: 'reserved',
             summary: `${room || 'room'} ${date} ${start_time}-${end_time}` };
  },

  schedule_meeting: async ({ title, date, start_time, duration_min, attendees }) => {
    const ref = id();
    notify('会议已创建', title);
    return { ref, status: 'scheduled',
             summary: `${title} ${date} ${start_time} (${duration_min || 30}min)` };
  },

  find_colleague: async ({ name_or_id }) => {
    // Mock directory lookup
    return { name: name_or_id, dept: '示例部门', phone: '1234-5678',
             email: `${(name_or_id||'unknown').toLowerCase()}@example.com` };
  },

  submit_it_ticket: async ({ category, summary, urgency }) => {
    const ref = id();
    notify('IT 工单已提交', `${category} · ${summary}`);
    return { ref, status: 'open', summary };
  },

  query_approval_status: async ({ workflow_type, reference_id }) => {
    return { matches: [
      { ref: id(), type: workflow_type, status: 'pending', submitted: '2 hours ago' },
    ]};
  },

  cancel_approval: async ({ reference_id }) => {
    notify('审批已撤回', reference_id);
    return { ref: reference_id, status: 'cancelled' };
  },

  forward_approval: async ({ task_id, to_user }) => {
    notify('审批已转交', `→ ${to_user}`);
    return { ref: task_id, forwarded_to: to_user };
  },

  query_attendance: async ({ period }) => {
    return { period, late_count: 2, missing_punches: 0, ot_hours: 8.5 };
  },

  query_leave_balance: async ({ type }) => {
    return { annual: 12, sick: 5, personal: 3 };
  },

  query_payroll: async ({ month }) => {
    return { month: month || '2026-04', base: 25000, bonus: 5000, tax: 4200, net: 25800 };
  },

  submit_purchase_request: async ({ item, quantity, estimated_amount }) => {
    const ref = id();
    notify('采购申请已提交', `${item} × ${quantity}`);
    return { ref, status: 'pending' };
  },

  register_visitor: async ({ visitor_name, visit_date, visit_time, company }) => {
    const ref = id();
    notify('访客已登记', `${visitor_name} (${company || 'guest'}) · ${visit_date}`);
    return { ref, status: 'registered' };
  },

  request_vehicle: async ({ date, start_time, destination, passengers }) => {
    const ref = id();
    notify('用车已申请', `${destination} · ${date} ${start_time}`);
    return { ref, status: 'pending' };
  },

  submit_seal_use: async ({ seal_type, document_title, copies, use_date }) => {
    const ref = id();
    notify('用印已申请', `${seal_type} · ${document_title}`);
    return { ref, status: 'pending' };
  },

  search_knowledge_base: async ({ query }) => {
    return { hits: [
      { title: `示例条目: ${query}`, url: 'https://wiki.example.com/...', score: 0.92 },
    ]};
  },

  borrow_equipment: async ({ equipment_type, borrow_date, return_date }) => {
    const ref = id();
    notify('设备借用已提交', `${equipment_type} · ${borrow_date}–${return_date}`);
    return { ref, status: 'pending' };
  },
};
