const { getSupabase, requireUser, json } = require('./_lib');

exports.handler = async (event, context) => {
  const user = requireUser(context);
  if (!user) return json(401, { error: 'Not signed in' });

  const supabase = getSupabase();

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('statuses')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) return json(500, { error: error.message });
    return json(200, { statuses: data });
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    if (!body.name || !body.name.trim()) {
      return json(400, { error: 'Status name is required' });
    }
    const { count } = await supabase
      .from('statuses')
      .select('*', { count: 'exact', head: true });
    const { data, error } = await supabase
      .from('statuses')
      .insert({
        name: body.name.trim(),
        color: body.color || '#12747D',
        sort_order: count || 0,
      })
      .select()
      .single();
    if (error) return json(500, { error: error.message });
    return json(201, { status: data });
  }

  if (event.httpMethod === 'PUT') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return json(400, { error: 'Status id is required' });

    // If renaming, keep projects that used the old name pointed at the new one
    if (body.name) {
      const { data: existing } = await supabase
        .from('statuses')
        .select('name')
        .eq('id', body.id)
        .single();
      if (existing && existing.name !== body.name.trim()) {
        await supabase
          .from('projects')
          .update({ status: body.name.trim() })
          .eq('status', existing.name);
      }
    }

    const updates = {};
    if (body.name) updates.name = body.name.trim();
    if (body.color) updates.color = body.color;
    const { data, error } = await supabase
      .from('statuses')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();
    if (error) return json(500, { error: error.message });
    return json(200, { status: data });
  }

  if (event.httpMethod === 'DELETE') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return json(400, { error: 'Status id is required' });

    const { count } = await supabase
      .from('statuses')
      .select('*', { count: 'exact', head: true });
    if ((count || 0) <= 1) {
      return json(400, { error: 'Keep at least one status' });
    }

    const { error } = await supabase.from('statuses').delete().eq('id', body.id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
