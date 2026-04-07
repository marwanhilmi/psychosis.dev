import { list as listRepos, select as selectRepos, status as repoStatus } from './repos'
import { trigger, getScore, getMyScore, jobStatus } from './analysis'
import { list as listDroogs, get as getDroog } from './droogs'
import { submit as submitReport, status as reportStatus, listRepos as listReportRepos } from './reports'
import { getProfile, connectedAccounts } from './users'

export default {
  repos: {
    list: listRepos,
    select: selectRepos,
    status: repoStatus,
  },
  analysis: {
    trigger,
    getScore,
    getMyScore,
    jobStatus,
  },
  droogs: {
    list: listDroogs,
    get: getDroog,
  },
  reports: {
    submit: submitReport,
    status: reportStatus,
    listRepos: listReportRepos,
  },
  users: {
    getProfile,
    connectedAccounts,
  },
}
