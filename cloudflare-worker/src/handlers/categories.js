import { json } from '../utils/response.js';

export function registerCategoryRoutes(router) {

  // GET /categories
  router.get('/categories', async (request, env) => {
    try {
      const categories = await env.DB.prepare('SELECT id, name, created_at, updated_at FROM categories ORDER BY name ASC').all();
      return json({ categories: categories.results || [] });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // POST /categories
  router.post('/categories', async (request, env) => {
    try {
      const body = await request.json();
      const { name } = body;
      if (!name || !String(name).trim()) {
        return json({ error: 'Category name is required' }, { status: 400 });
      }
      const catName = String(name).trim();
      const existing = await env.DB.prepare('SELECT id, name FROM categories WHERE name=?').bind(catName).first();
      if (existing) {
        return json({ id: existing.id, name: existing.name, created: false });
      }
      const catUuid = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').bind(catUuid, catName).run();
      return json({ id: catUuid, name: catName, created: true });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // GET /categories/:id/usage
  router.get('/categories/:id/usage', async (request, env) => {
    try {
      const categoryId = request.params.id;
      const usageResult = await env.DB.prepare('SELECT COUNT(*) as count FROM content_item_categories WHERE category_id=?').bind(categoryId).first();
      const count = usageResult ? (usageResult.count || 0) : 0;
      return json({ category_id: categoryId, usage_count: count });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // PATCH /categories/:id
  router.patch('/categories/:id', async (request, env) => {
    try {
      const categoryId = request.params.id;
      const body = await request.json();
      const { name } = body;
      if (!name || !String(name).trim()) {
        return json({ error: 'Category name is required' }, { status: 400 });
      }
      const catName = String(name).trim();
      const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=? AND id!=?').bind(catName, categoryId).first();
      if (existing) {
        return json({ error: 'Category with this name already exists' }, { status: 400 });
      }
      await env.DB.prepare('UPDATE categories SET name=?, updated_at=strftime(\'%s\',\'now\') WHERE id=?').bind(catName, categoryId).run();
      return json({ id: categoryId, name: catName });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // DELETE /categories/:id
  router.delete('/categories/:id', async (request, env) => {
    try {
      const categoryId = request.params.id;
      const usageResult = await env.DB.prepare('SELECT COUNT(*) as count FROM content_item_categories WHERE category_id=?').bind(categoryId).first();
      const usageCount = usageResult ? (usageResult.count || 0) : 0;
      if (usageCount > 0) {
        return json({ error: `Cannot delete category: it is currently assigned to ${usageCount} content item(s). Please remove the category from all content items first.` }, { status: 400 });
      }
      await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(categoryId).run();
      return json({ ok: true, deleted: categoryId });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
