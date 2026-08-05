const { getSupabase, requireUser, json } = require('./_lib');

exports.handler = async (event, context) => {
  const user = requireUser(context);
  if (!user) return json(401, { error: 'Not signed in' });

  const supabase = getSupabase();

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return json(500, { error: error.message });
    return json(200, { projects: data });
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    if (!body.name || !body.name.trim()) {
      return json(400, { error: 'Project name is required' });
    }
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: body.name.trim(), status: body.status || 'Not Started' })
      .select()
      .single();
    if (error) return json(500, { error: error.message });
    return json(201, { project: data });
  }

  if (event.httpMethod === 'PUT') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return json(400, { error: 'Project id is required' });
    const updates = { updated_at: new Date().toISOString() };
    if (body.status) updates.status = body.status;
    if (body.name) updates.name = body.name.trim();
    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();
    if (error) return json(500, { error: error.message });
    return json(200, { project: data });
  }

  if (event.httpMethod === 'DELETE') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return json(400, { error: 'Project id is required' });
    const { error } = await supabase.from('projects').delete().eq('id', body.id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
