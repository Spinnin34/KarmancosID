<script setup lang="ts">
import { computed } from "vue";
import Avatar from "@/components/ui/Avatar.vue";
import Badge from "@/components/ui/Badge.vue";
import Button from "@/components/ui/Button.vue";
import Input from "@/components/ui/Input.vue";
import Table from "@/components/ui/Table.vue";
import AdminRecoveryCodeAction from "./AdminRecoveryCodeAction.vue";
import type { AccountFilter, AdminUser } from "./contracts";

const props = defineProps<{
  users: AdminUser[];
  currentUserId: string | null;
  currentUserEmail: string | null;
  query: string;
  filter: AccountFilter;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  "update:filter": [value: AccountFilter];
  edit: [user: AdminUser];
  access: [user: AdminUser, patch: { active?: boolean; role?: string }];
}>();

const filters: Array<{ id: AccountFilter; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "active", label: "Activas" },
  { id: "blocked", label: "Bloqueadas" },
  { id: "admin", label: "Administradores" },
];

const filteredUsers = computed(() => {
  const query = props.query.trim().toLocaleLowerCase("es");
  return props.users.filter((user) => {
    const matchesQuery = !query || [user.displayName, user.username, user.email]
      .some((value) => value.toLocaleLowerCase("es").includes(query));
    const matchesFilter = props.filter === "all"
      || (props.filter === "active" && user.active)
      || (props.filter === "blocked" && !user.active)
      || (props.filter === "admin" && user.role === "ADMIN");
    return matchesQuery && matchesFilter;
  });
});

function userInitials(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("es-ES")).join("") || "?";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
</script>

<template>
  <section class="admin-section" aria-labelledby="admin-users-title">
    <div class="admin-section-heading">
      <div>
        <h2 id="admin-users-title">Cuentas de Karmancos ID</h2>
        <p>Edita perfiles, administra roles y controla el acceso. Los cambios de perfil revocan sesiones y autorizaciones.</p>
      </div>
      <Badge variant="soft" color="info">{{ filteredUsers.length }} cuentas</Badge>
    </div>

    <div class="admin-user-tools">
      <Input
        id="account-search"
        :model-value="query"
        label="Buscar cuenta"
        placeholder="Nombre, usuario o correo"
        @update:model-value="emit('update:query', String($event))"
      />
      <div class="account-filter-list" role="group" aria-label="Filtrar cuentas">
        <button
          v-for="item in filters"
          :key="item.id"
          type="button"
          class="account-filter"
          :aria-pressed="filter === item.id"
          @click="emit('update:filter', item.id)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div v-if="users.length" class="table-wrap">
      <Table caption="Cuentas de Karmancos ID" variant="surface" density="compact" :column-count="6" hover>
        <template #header>
          <thead>
            <tr>
              <th scope="col">Cuenta</th>
              <th scope="col">Acceso</th>
              <th scope="col">Rol</th>
              <th scope="col">Alta</th>
              <th scope="col">Perfil</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
        </template>
        <tbody>
          <tr v-for="user in filteredUsers" :key="user.id">
            <th scope="row">
              <div class="admin-user-identity">
                <Avatar :src="user.picture || undefined" :label="`Foto de perfil de ${user.displayName}`" :fallback="userInitials(user.displayName)" size="sm" shape="circle" />
                <div class="table-cell-main">
                  <strong>{{ user.displayName }}</strong>
                  <small>@{{ user.username }} · {{ user.email }}</small>
                </div>
              </div>
            </th>
            <td data-label="Acceso"><Badge variant="soft" :color="user.active ? 'success' : 'destructive'">{{ user.active ? "Activa" : "Bloqueada" }}</Badge></td>
            <td data-label="Rol"><Badge variant="outline" color="secondary">{{ user.role === "ADMIN" ? "Admin" : "Usuario" }}</Badge></td>
            <td data-label="Alta">{{ formatDate(user.createdAt) }}</td>
            <td data-label="Perfil">
              <Button variant="outline" size="sm" type="button" :disabled="user.email === currentUserEmail" @click="emit('edit', user)">
                {{ user.email === currentUserEmail ? "Mi cuenta" : "Editar" }}
              </Button>
            </td>
            <td data-label="Acciones">
              <div class="table-actions">
                <Button
                  variant="outline"
                  :color="user.active ? 'destructive' : 'primary'"
                  size="sm"
                  type="button"
                  :disabled="user.id === currentUserId"
                  @click="emit('access', user, { active: !user.active })"
                >
                  {{ user.active ? "Bloquear" : "Reactivar" }}
                </Button>
                <Button
                  v-if="user.role === 'USER'"
                  variant="glass"
                  color="secondary"
                  size="sm"
                  type="button"
                  @click="emit('access', user, { role: 'ADMIN' })"
                >
                  Hacer admin
                </Button>
                <Button
                  v-else
                  variant="glass"
                  color="secondary"
                  size="sm"
                  type="button"
                  :disabled="user.id === currentUserId"
                  @click="emit('access', user, { role: 'USER' })"
                >
                  Quitar admin
                </Button>
                <AdminRecoveryCodeAction :user-id="user.id" :email="user.email" :disabled="user.id === currentUserId || !user.active" />
              </div>
            </td>
          </tr>
        </tbody>
      </Table>
      <div v-if="filteredUsers.length === 0" class="empty-state">No hay cuentas que coincidan con esa búsqueda y ese filtro.</div>
    </div>
    <div v-else class="empty-state">No hay cuentas todavía.</div>
  </section>
</template>
