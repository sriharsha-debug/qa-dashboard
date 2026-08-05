const { getSupabase, requireUser, json } = require('./_lib');

exports.handler = async (event, context) => {
  const user = requireUser(context);
  if (!user) return json(401, { error: 'Not signed in' });

  const supabase = getSupabase();

  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    let query = supabase
      .from('daily_reports')
      .select('*, projects(name)')
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (params.project_id) query = query.eq('project_id', params.project_id);
    if (params.date) query = query.eq('report_date', params.date);

    const { data, error } = await query;
    if (error) return json(500, { error: error.message });
    return json(200, { reports: data });
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    if (!body.project_id) return json(400, { error: 'project_id is required' });

    const row = {
      project_id: body.project_id,
      report_date: body.report_date || new Date().toISOString().slice(0, 10),
      project_manager: body.project_manager || null,
      bugsheet: body.bugsheet || null,
      test_cases: Number.isFinite(+body.test_cases) ? +body.test_cases : 0,
      ui_bugs: Number.isFinite(+body.ui_bugs) ? +body.ui_bugs : 0,
      functionality_bugs: Number.isFinite(+body.functionality_bugs) ? +body.functionality_bugs : 0,
      remarks: body.remarks || null,
      sign_off: !!body.sign_off,
      notes: body.notes || null,
    };

    const { data, error } = await supabase
      .from('daily_reports')
      .insert(row)
      .select('*, projects(name)')
      .single();
    if (error) return json(500, { error: error.message });
    return json(201, { report: data });
  }

  if (event.httpMethod === 'DELETE') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return json(400, { error: 'Report id is required' });
    const { error } = await supabase.from('daily_reports').delete().eq('id', body.id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
