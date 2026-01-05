import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ContentTypeGrid from '../components/ContentTypeGrid';
import type { ContentType } from '../types/content';

export default function LibraryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedType, setSelectedType] = useState<ContentType>(() => {
    const typeParam = searchParams.get('type');
    if (typeParam === 'movie' || typeParam === 'series' || typeParam === 'book' || typeParam === 'video') {
      return typeParam as ContentType;
    }
    return 'movie'; // Default to movie
  });

  // Update URL when type changes
  useEffect(() => {
    const currentType = searchParams.get('type');
    if (currentType !== selectedType) {
      navigate(`/content?type=${selectedType}`, { replace: true });
    }
  }, [selectedType, navigate, searchParams]);

  // Handle content type change
  const handleContentTypeChange = (type: ContentType) => {
    setSelectedType(type);
  };

  return (
    <ContentTypeGrid
      type={selectedType}
      onlySelectedMainLanguage
      showContentTypeSelector={true}
      onContentTypeChange={handleContentTypeChange}
    />
  );
}

