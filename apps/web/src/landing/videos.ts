// Short product videos made in HyperFrames, compressed into ./videos.
//
// Each video has a poster frame (the .jpg beside it), taken 5 seconds in, where the app is on
// screen. The README uses the same posters, linking back to the landing page.
import dashboardVideo from './videos/dashboard.mp4?url';
import dashboardPoster from './videos/dashboard.jpg?url';
import queryVideo from './videos/query.mp4?url';
import queryPoster from './videos/query.jpg?url';
import reportDesignerVideo from './videos/report-designer.mp4?url';
import reportDesignerPoster from './videos/report-designer.jpg?url';
import formsVideo from './videos/forms.mp4?url';
import formsPoster from './videos/forms.jpg?url';
import terminologyVideo from './videos/terminology.mp4?url';
import terminologyPoster from './videos/terminology.jpg?url';
import nationalCodesVideo from './videos/national-codes.mp4?url';
import nationalCodesPoster from './videos/national-codes.jpg?url';
import workflowsVideo from './videos/workflows.mp4?url';
import workflowsPoster from './videos/workflows.jpg?url';

export interface ProductVideo {
  name: string;
  label: string;
  /** What the video shows, for the poster's alt text. */
  description: string;
  video: string;
  poster: string;
}

export const VIDEOS: ProductVideo[] = [
  {
    name: 'dashboard',
    label: 'Dashboards',
    description: 'Building a dashboard chart without writing code',
    video: dashboardVideo,
    poster: dashboardPoster,
  },
  {
    name: 'query',
    label: 'Query',
    description: 'Querying the warehouse by point and click or by SQL',
    video: queryVideo,
    poster: queryPoster,
  },
  {
    name: 'report-designer',
    label: 'Report designer',
    description: 'Laying out a query result as a printable report',
    video: reportDesignerVideo,
    poster: reportDesignerPoster,
  },
  {
    name: 'forms',
    label: 'Forms',
    description: 'Turning a paper lab request into a form whose answers map to FHIR',
    video: formsVideo,
    poster: formsPoster,
  },
  {
    name: 'terminology',
    label: 'Terminology',
    description: 'Mapping a local lab test code to LOINC',
    video: terminologyVideo,
    poster: terminologyPoster,
  },
  {
    name: 'national-codes',
    label: 'Code mapping',
    description: "Mapping each lab's own test codes to one national catalog",
    video: nationalCodesVideo,
    poster: nationalCodesPoster,
  },
  {
    name: 'workflows',
    label: 'Workflows',
    description: 'Connecting nodes into a workflow that checks and stores results',
    video: workflowsVideo,
    poster: workflowsPoster,
  },
];
