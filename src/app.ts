import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';

const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(cors());

// Request logging
app.use(requestLogger);

// JSON body parser
app.use(express.json({ limit: '10mb' }));

// URL-encoded body parser
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', routes);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
