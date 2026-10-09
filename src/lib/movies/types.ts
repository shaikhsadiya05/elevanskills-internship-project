export type MovieCategory = "trending" | "popular" | "top-rated" | "upcoming" | "search";

export type Movie = {
  id: string;
  title: string;
  overview: string;
  releaseDate: string;
  rating: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  genres: string[];
  cast: Array<{ id: string; name: string; role: string; profileUrl: string | null }>;
  trailerUrl: string | null;
};

export type MovieReview = {
  id: string;
  author: string;
  content: string;
  rating: number | null;
};

export type MovieRecommendation = Movie;

export type MoviePage = {
  results: Movie[];
  page: number;
  totalPages: number;
  nextCursor: string | null;
  provider: "tmdb" | "omdb";
};

export type MovieListInput = {
  category: MovieCategory;
  query?: string;
  cursor?: string | null;
};

export interface MovieProvider {
  readonly name: "tmdb" | "omdb";
  list(input: MovieListInput): Promise<MoviePage>;
  getDetails(id: string): Promise<Movie>;
  getCredits(id: string): Promise<Movie["cast"]>;
  getReviews(id: string): Promise<MovieReview[]>;
  getRecommendations(id: string): Promise<MovieRecommendation[]>;
}