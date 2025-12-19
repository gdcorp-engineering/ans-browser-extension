import type { SiteProfile } from './types';

/**
 * Default site profiles that provide contextual information about platforms
 * These help the AI understand what sites are and user expectations
 * Unlike site instructions, these are informational rather than directive
 */
export const DEFAULT_SITE_PROFILES: SiteProfile[] = [
  {
    id: 'confluence-profile',
    domainPattern: '*.atlassian.net/wiki/*',
    name: 'Confluence',
    description: 'Atlassian Confluence - Collaborative Wiki and Documentation Platform',
    context: {
      platform: 'Confluence is a collaborative wiki platform designed for creating, organizing, and sharing documentation, meeting notes, project plans, and team knowledge in a structured way.',
      primaryUse: 'Teams use Confluence to create pages with rich content, organize information in spaces, collaborate on documentation, and maintain institutional knowledge. Common activities include writing documentation, creating meeting notes, project planning, and knowledge sharing.',
      userExpectations: [
        'When users request page creation with a specific title, they expect the exact title to be used - not template defaults or suggestions',
        'New paragraphs should be cleanly formatted without extra leading spaces',
        'Content should be added to existing pages without replacing or corrupting existing content',
        'Page editing should preserve existing formatting and structure',
        'Publishing should only happen when user explicitly requests it and should save changes reliably without errors'
      ],
      commonElements: [
        'Page title fields (often placeholder "Give this page a title")',
        'Rich content editor areas with contenteditable regions',
        'Create/Edit/Publish workflow buttons in toolbar and modals',
        'Template selection options for new pages',
        'Spaces for organizing related pages',
        'Navigation breadcrumbs showing page hierarchy'
      ],
      terminology: {
        'page': 'A wiki document containing a title and formatted content area where users can write and collaborate',
        'space': 'A container that organizes related pages, similar to a project or team workspace',
        'editor': 'The interface for creating and editing page content, with rich text formatting capabilities',
        'contenteditable': 'HTML areas where users can directly type and format text content',
        'publish': 'The action to save and make a page visible to other users in the space',
        'template': 'Pre-designed page layouts for common use cases like meeting notes or project plans'
      }
    },
    enabled: true
  },
  {
    id: 'jira-profile',
    domainPattern: '*.atlassian.net',
    name: 'Jira',
    description: 'Atlassian Jira - Project Management and Issue Tracking Platform',
    context: {
      platform: 'Jira is a project management and issue tracking platform used by development teams and organizations to plan, track, and manage work through structured workflows.',
      primaryUse: 'Teams use Jira to create and manage issues (bugs, tasks, stories), track project progress, plan sprints, and collaborate on work items. Common activities include bug reporting, task management, project planning, and workflow tracking.',
      userExpectations: [
        'When creating issues, users expect to specify the project, issue type, and summary accurately',
        'Issue searches should return relevant results based on keys, keywords, or assignees',
        'Status updates and comments should be saved reliably',
        'Issue creation should result in a trackable issue key (e.g., PROJ-123)',
        'Workflows should respect project-specific configurations and permissions'
      ],
      commonElements: [
        'Issue creation dialogs with project dropdowns and required fields',
        'Search functionality for finding issues by key, text, or filters',
        'Issue detail pages with status, assignee, and comment sections',
        'Project boards and backlogs for organizing work',
        'Workflow transitions and status indicators',
        'Navigation between projects and issue views'
      ],
      terminology: {
        'issue': 'A work item that can be a bug, task, story, or other trackable unit of work',
        'project': 'A container for organizing related issues and work items',
        'workflow': 'The process and states an issue moves through from creation to completion',
        'board': 'A visual representation of issues in different workflow states',
        'sprint': 'A time-boxed period for completing a set of issues',
        'backlog': 'A prioritized list of issues waiting to be worked on'
      }
    },
    enabled: true
  }
];