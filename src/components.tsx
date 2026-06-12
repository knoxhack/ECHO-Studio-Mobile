import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Button, Card, Chip, Divider, IconButton, Surface, Text, TextInput, useTheme } from 'react-native-paper'
import type { EchoMobileProject } from './mobileTypes'

export function ScreenFrame({
  title,
  subtitle,
  actions,
  children
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="headlineSmall">{title}</Text>
          {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  )
}

export function ProjectStrip({
  project,
  compact = false
}: {
  project: EchoMobileProject | null
  compact?: boolean
}) {
  if (!project) {
    return (
      <Surface mode="flat" style={styles.strip}>
        <Text>No project selected</Text>
      </Surface>
    )
  }
  return (
    <Surface mode="flat" style={styles.strip}>
      <View style={styles.rowWrap}>
        <Chip compact icon="folder">{project.manifest.name}</Chip>
        <Chip compact icon={project.dirty ? 'circle-edit-outline' : 'check-circle-outline'}>
          {project.dirty ? 'Dirty' : 'Synced'}
        </Chip>
        <Chip compact icon="shield-check">
          {project.lastValidation?.compatibilityScore ?? 0}%
        </Chip>
        {!compact && project.github ? (
          <Chip compact icon="github">{project.github.owner}/{project.github.repo}</Chip>
        ) : null}
      </View>
    </Surface>
  )
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction
}: {
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <Surface mode="flat" style={styles.empty}>
      <Text variant="titleMedium">{title}</Text>
      {body ? <Text style={styles.muted}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button mode="contained" icon="plus" onPress={onAction} style={styles.topGap}>
          {actionLabel}
        </Button>
      ) : null}
    </Surface>
  )
}

export function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: string | number
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
}) {
  const theme = useTheme()
  const color =
    tone === 'good'
      ? '#63d47c'
      : tone === 'warn'
        ? theme.colors.secondary
        : tone === 'bad'
          ? theme.colors.error
          : theme.colors.primary
  return (
    <Surface mode="flat" style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text variant="headlineSmall" style={{ color }}>{value}</Text>
    </Surface>
  )
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="titleMedium" style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

export function Field({
  label,
  value,
  onChangeText,
  multiline,
  secureTextEntry,
  keyboardType
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  multiline?: boolean
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'numeric' | 'url'
}) {
  return (
    <TextInput
      mode="outlined"
      dense
      label={label}
      value={value}
      onChangeText={onChangeText}
      multiline={multiline}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      style={styles.field}
    />
  )
}

export function PillRow({
  items,
  selected,
  onToggle,
  multi = false
}: {
  items: Array<{ key: string; label: string; icon?: string }>
  selected: string[]
  onToggle: (key: string) => void
  multi?: boolean
}) {
  return (
    <View style={styles.rowWrap}>
      {items.map((item) => {
        const active = selected.includes(item.key)
        return (
          <Chip
            key={item.key}
            icon={item.icon}
            selected={active}
            showSelectedOverlay
            onPress={() => {
              if (!multi && active) return
              onToggle(item.key)
            }}
          >
            {item.label}
          </Chip>
        )
      })}
    </View>
  )
}

export function RecordCard({
  title,
  subtitle,
  selected,
  right,
  onPress,
  onDelete
}: {
  title: string
  subtitle?: string
  selected?: boolean
  right?: ReactNode
  onPress?: () => void
  onDelete?: () => void
}) {
  return (
    <Card mode={selected ? 'elevated' : 'contained'} style={[styles.recordCard, selected ? styles.selectedCard : null]} onPress={onPress}>
      <Card.Content style={styles.recordContent}>
        <View style={styles.recordText}>
          <Text variant="titleSmall">{title}</Text>
          {subtitle ? <Text style={styles.muted} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
        {right}
        {onDelete ? <IconButton icon="delete-outline" size={20} onPress={onDelete} /> : null}
      </Card.Content>
    </Card>
  )
}

export function Hairline() {
  return <Divider style={styles.divider} />
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#071018'
  },
  screenContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 32
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  headerText: {
    flex: 1,
    gap: 4
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  muted: {
    color: '#9fb2bf'
  },
  strip: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#0d1721'
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center'
  },
  empty: {
    padding: 18,
    borderRadius: 8,
    backgroundColor: '#101d28',
    gap: 8
  },
  topGap: {
    marginTop: 8,
    alignSelf: 'flex-start'
  },
  metric: {
    flex: 1,
    minWidth: 132,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#101d28'
  },
  metricLabel: {
    color: '#9fb2bf',
    fontSize: 12,
    marginBottom: 4
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  section: {
    gap: 10
  },
  sectionTitle: {
    marginTop: 4
  },
  field: {
    marginBottom: 8,
    backgroundColor: '#0d1721'
  },
  recordCard: {
    marginBottom: 8,
    backgroundColor: '#101d28'
  },
  selectedCard: {
    borderColor: '#41d6c3',
    borderWidth: 1
  },
  recordContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  recordText: {
    flex: 1,
    gap: 2
  },
  divider: {
    backgroundColor: '#243747',
    marginVertical: 4
  }
})
